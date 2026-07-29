use image::{ImageBuffer, Rgb};
use rayon::prelude::*;
use tauri::{command, ipc::Response};

/// DLT 算法：从 4 组源→目标点对计算 3×3 Homography 矩阵。
/// 设 h8 = 1，解 8×8 线性方程组，返回 [h0..h8]（行主序）。
fn compute_homography(
    src: [(f64, f64); 4],
    dst: [(f64, f64); 4],
) -> Result<[f64; 9], String> {
    let mut a = [[0.0f64; 9]; 8];

    for i in 0..4 {
        let (x, y) = src[i];
        let (xp, yp) = dst[i];
        let r0 = i * 2;
        let r1 = r0 + 1;
        a[r0][0] = x;
        a[r0][1] = y;
        a[r0][2] = 1.0;
        a[r0][6] = -xp * x;
        a[r0][7] = -xp * y;
        a[r0][8] = xp;
        a[r1][3] = x;
        a[r1][4] = y;
        a[r1][5] = 1.0;
        a[r1][6] = -yp * x;
        a[r1][7] = -yp * y;
        a[r1][8] = yp;
    }

    let n = 8;
    let mut col = 0;
    while col < n {
        let mut pivot = col;
        let mut max_val = a[col][col].abs();
        for row in (col + 1)..n {
            let v = a[row][col].abs();
            if v > max_val {
                max_val = v;
                pivot = row;
            }
        }
        if max_val < 1e-12 {
            return Err("矩阵奇异，无法计算透视变换（四点可能共线）".to_string());
        }
        if pivot != col {
            a.swap(col, pivot);
        }
        let pivot_val = a[col][col];
        for j in col..=n {
            a[col][j] /= pivot_val;
        }
        for row in (col + 1)..n {
            let factor = a[row][col];
            if factor != 0.0 {
                for j in col..=n {
                    a[row][j] -= factor * a[col][j];
                }
            }
        }
        col += 1;
    }

    let mut h = [0.0f64; 9];
    for i in (0..n).rev() {
        let mut sum = a[i][n];
        for j in (i + 1)..n {
            sum -= a[i][j] * h[j];
        }
        h[i] = sum / a[i][i];
    }
    h[8] = 1.0;

    Ok(h)
}

/// 应用 Homography，将 RGB 源图像透视变形到目标画布上，返回 row-major RGBA。
///
/// 性能要点：
/// - 整张 bg_w × bg_h 输出按行切分，用 rayon 并行（每行一个任务，无行间依赖）。
/// - 直接用平面字节索引读写像素，避免 `get_pixel`/`put_pixel` 的边界检查与封装开销。
/// - 内联双线性插值，采样时一次取 4 邻接像素做 3 通道插值（alpha 固定 255）。
/// - 越界像素保持 0（透明），与原有 `from_pixel([0,0,0,0])` 语义一致。
fn warp_perspective(
    src: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    h: &[f64; 9],
    bg_w: u32,
    bg_h: u32,
) -> Vec<u8> {
    let src_iw = src.width();
    let src_ih = src.height();
    let src_w = src_iw as f64;
    let src_h = src_ih as f64;
    let raw = src.as_raw();
    let pixel_bytes = 3usize;
    let row_bytes = src_iw as usize * pixel_bytes;

    let out_row_bytes = bg_w as usize * 4;
    let mut out = vec![0u8; bg_h as usize * out_row_bytes];

    // 平面 buffer 按行切分：每个 chunk 是一行 RGBA（bg_w × 4 字节）。
    out.par_chunks_mut(out_row_bytes)
        .enumerate()
        .for_each(|(dst_y, row)| {
            let yp = dst_y as f64;
            // 行内常数预提取，帮编译器做寄存器分配。
            let h0 = h[0];
            let h1 = h[1];
            let h2 = h[2];
            let h3 = h[3];
            let h4 = h[4];
            let h5 = h[5];
            let h6 = h[6];
            let h7 = h[7];

            for dst_x in 0..bg_w {
                let xp = dst_x as f64;

                // 复用计算：两对分子分母共用的基项。
                let a = h0 - xp * h6;
                let b = h4 - yp * h7;
                let c = h1 - xp * h7;
                let d = h3 - yp * h6;
                let det = a * b - c * d;
                if det.abs() < 1e-12 {
                    continue;
                }

                let src_x = ((xp - h2) * b - c * (yp - h5)) / det;
                let src_y = (a * (yp - h5) - (xp - h2) * d) / det;

                if !(src_x >= 0.0 && src_x < src_w && src_y >= 0.0 && src_y < src_h) {
                    continue;
                }

                // 双线性插值（已 clamp 到有效范围）。
                let sx = src_x.clamp(0.0, src_w - 1.0);
                let sy = src_y.clamp(0.0, src_h - 1.0);
                let x0 = sx.floor() as u32;
                let y0 = sy.floor() as u32;
                let x1 = (x0 + 1).min(src_iw - 1);
                let y1 = (y0 + 1).min(src_ih - 1);
                let dx = sx - x0 as f64;
                let dy = sy - y0 as f64;
                let w00 = (1.0 - dx) * (1.0 - dy);
                let w10 = dx * (1.0 - dy);
                let w01 = (1.0 - dx) * dy;
                let w11 = dx * dy;

                let i00 = (y0 as usize * row_bytes) + (x0 as usize * pixel_bytes);
                let i10 = (y0 as usize * row_bytes) + (x1 as usize * pixel_bytes);
                let i01 = (y1 as usize * row_bytes) + (x0 as usize * pixel_bytes);
                let i11 = (y1 as usize * row_bytes) + (x1 as usize * pixel_bytes);

                let off = dst_x as usize * 4;
                for c in 0..3 {
                    let v = raw[i00 + c] as f64 * w00
                        + raw[i10 + c] as f64 * w10
                        + raw[i01 + c] as f64 * w01
                        + raw[i11 + c] as f64 * w11;
                    row[off + c] = v.round() as u8;
                }
                row[off + 3] = 255;
            }
        });

    out
}

/// 对资料图片做透视变形，输出 bg_w × bg_h 的 RGBA 像素字节（row-major）。
/// 内部纯逻辑：不经过 IPC 包装，便于单元测试验证像素内容。
///
/// 关键：用 `into_rgb8()` 把解码结果解包为 `ImageBuffer<Rgb<u8>>`。
/// 资料图都是 JPEG，`image::load_from_memory` 返回 `ImageRgb8`，
/// `into_rgb8()` 此时不做任何像素拷贝——直接挪走内部 buffer，
/// 省掉原先 `to_rgba8()` 那份约 30+ MB 的整图 RGBA 转换拷贝。
fn warp_to_a4_bytes(
    material_bytes: &[u8],
    bg_w: u32,
    bg_h: u32,
    corners: [f64; 8],
) -> Result<Vec<u8>, String> {
    let source = image::load_from_memory(material_bytes)
        .map_err(|e| format!("解码资料图片失败：{e}"))?;
    let (src_w, src_h) = (source.width() as f64, source.height() as f64);

    let src_points: [(f64, f64); 4] = [
        (0.0, 0.0),
        (src_w, 0.0),
        (src_w, src_h),
        (0.0, src_h),
    ];

    let dst_points: [(f64, f64); 4] = [
        (corners[0] * bg_w as f64, corners[1] * bg_h as f64),
        (corners[2] * bg_w as f64, corners[3] * bg_h as f64),
        (corners[4] * bg_w as f64, corners[5] * bg_h as f64),
        (corners[6] * bg_w as f64, corners[7] * bg_h as f64),
    ];

    let h = compute_homography(src_points, dst_points)?;

    // into_rgb8()：对 ImageRgb8 是零拷贝解包；其它变体走转换（不会发生在 JPEG 路径）。
    let source_rgb = source.into_rgb8();
    let warped = warp_perspective(&source_rgb, &h, bg_w, bg_h);

    // 直接返回 row-major RGBA 像素字节，省去 PNG 编解码开销。
    Ok(warped)
}

/// Tauri 命令：对资料图片做透视变形，返回 RGBA 字节。
/// 用 Response 走二进制 IPC 通道，避免 Vec<u8> 被 JSON 序列化为数字数组。
#[command]
pub fn warp_to_a4(
    material_bytes: Vec<u8>,
    bg_w: u32,
    bg_h: u32,
    corners: [f64; 8],
) -> Result<Response, String> {
    let bytes = warp_to_a4_bytes(&material_bytes, bg_w, bg_h, corners)?;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba};

    #[test]
    fn test_identity_homography() {
        let src = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)];
        let dst = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)];
        let h = compute_homography(src, dst).unwrap();
        assert!((h[0] - 1.0).abs() < 1e-6);
        assert!((h[4] - 1.0).abs() < 1e-6);
        assert!(h[1].abs() < 1e-6);
        assert!(h[2].abs() < 1e-6);
        assert!(h[5].abs() < 1e-6);
        assert!(h[6].abs() < 1e-6);
        assert!(h[7].abs() < 1e-6);
    }

    #[test]
    fn test_translation_homography() {
        let src = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)];
        let dst = [(10.0, 20.0), (110.0, 20.0), (110.0, 120.0), (10.0, 120.0)];
        let h = compute_homography(src, dst).unwrap();
        let sx = 50.0;
        let sy = 50.0;
        let denom = h[6] * sx + h[7] * sy + h[8];
        let dx = (h[0] * sx + h[1] * sy + h[2]) / denom;
        let dy = (h[3] * sx + h[4] * sy + h[5]) / denom;
        assert!((dx - 60.0).abs() < 1.0, "expected dx≈60, got {dx}");
        assert!((dy - 70.0).abs() < 1.0, "expected dy≈70, got {dy}");
    }

    #[test]
    fn test_collinear_points_returns_error() {
        let src = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)];
        let dst = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)];
        let result = compute_homography(src, dst);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("矩阵奇异"));
    }

    #[test]
    fn test_warp_perspective_output_size() {
        let src = ImageBuffer::from_pixel(10, 10, Rgb([255, 0, 0]));
        let h = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let out = warp_perspective(&src, &h, 20, 20);
        // 20×20×4 RGBA，全红不透明。
        assert_eq!(out.len(), 20 * 20 * 4);
        assert_eq!(&out[0..4], &[255, 0, 0, 255]);
        assert_eq!(&out[(5 * 20 + 5) * 4..(5 * 20 + 5) * 4 + 4], &[255, 0, 0, 255]);
    }

    #[test]
    fn test_warp_perspective_bilinear_center() {
        // 3×3 图，中心十字 RGB 不同，验证双线性在 (1,1) 取中心像素。
        let mut img = ImageBuffer::new(3, 3);
        for p in img.pixels_mut() {
            *p = Rgb([0, 0, 0]);
        }
        img.put_pixel(1, 1, Rgb([0, 255, 0]));
        let h = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let out = warp_perspective(&img, &h, 3, 3);
        let center = (1 * 3 + 1) * 4;
        assert_eq!(out[center + 1], 255, "中心点应为绿色 G=255");
    }

    #[test]
    fn test_warp_to_a4_identity() {
        let mut img = ImageBuffer::new(10, 10);
        for p in img.pixels_mut() {
            *p = Rgba([255, 0, 0, 255]);
        }
        let mut png_bytes = Vec::new();
        DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
            .unwrap();
        let corners: [f64; 8] = [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0];
        let result = warp_to_a4_bytes(&png_bytes, 20, 20, corners).unwrap();
        // 返回原始 RGBA：20×20×4 = 1600 字节，全红不透明像素。
        assert_eq!(result.len(), 1600);
        assert_eq!(&result[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn test_warp_to_a4_invalid_image() {
        let corners: [f64; 8] = [0.0, 0.0, 0.5, 0.0, 0.5, 0.5, 0.0, 0.5];
        let result = warp_to_a4_bytes(&[0, 1, 2, 3], 20, 20, corners);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("解码资料图片失败"));
    }

    /// 并行 warp 与单线程结果逐字节一致：保证 rayon 拆行没有引入语义变化。
    #[test]
    fn test_warp_perspective_matches_scalar() {
        let mut img = ImageBuffer::new(8, 6);
        for y in 0..6 {
            for x in 0..8 {
                let v = ((x * 31 + y * 17) % 256) as u8;
                img.put_pixel(x, y, Rgb([v, 255 - v, v / 2]));
            }
        }
        // 一个带透视分量的 H（轻微斜切）。
        let corners: [f64; 8] = [0.05, 0.0, 1.0, 0.1, 0.95, 1.0, 0.0, 0.9];
        let bg_w = 32u32;
        let bg_h = 32u32;
        let h = compute_homography(
            [(0.0, 0.0), (8.0, 0.0), (8.0, 6.0), (0.0, 6.0)],
            [
                (corners[0] * bg_w as f64, corners[1] * bg_h as f64),
                (corners[2] * bg_w as f64, corners[3] * bg_h as f64),
                (corners[4] * bg_w as f64, corners[5] * bg_h as f64),
                (corners[6] * bg_w as f64, corners[7] * bg_h as f64),
            ],
        )
        .unwrap();

        let parallel = warp_perspective(&img, &h, bg_w, bg_h);

        // 单线程基准：遍历同逻辑，不依赖 rayon。
        let src_iw = img.width();
        let src_ih = img.height();
        let raw = img.as_raw();
        let row_bytes = src_iw as usize * 3;
        let mut scalar = vec![0u8; bg_h as usize * bg_w as usize * 4];
        for dst_y in 0..bg_h {
            for dst_x in 0..bg_w {
                let xp = dst_x as f64;
                let yp = dst_y as f64;
                let det = (h[0] - xp * h[6]) * (h[4] - yp * h[7])
                    - (h[1] - xp * h[7]) * (h[3] - yp * h[6]);
                if det.abs() < 1e-12 {
                    continue;
                }
                let src_x = ((xp - h[2]) * (h[4] - yp * h[7])
                    - (h[1] - xp * h[7]) * (yp - h[5]))
                    / det;
                let src_y = ((h[0] - xp * h[6]) * (yp - h[5])
                    - (xp - h[2]) * (h[3] - yp * h[6]))
                    / det;
                if !(src_x >= 0.0 && src_x < src_iw as f64 && src_y >= 0.0 && src_y < src_ih as f64)
                {
                    continue;
                }
                let sx = src_x.clamp(0.0, src_iw as f64 - 1.0);
                let sy = src_y.clamp(0.0, src_ih as f64 - 1.0);
                let x0 = sx.floor() as u32;
                let y0 = sy.floor() as u32;
                let x1 = (x0 + 1).min(src_iw - 1);
                let y1 = (y0 + 1).min(src_ih - 1);
                let dx = sx - x0 as f64;
                let dy = sy - y0 as f64;
                let off = (dst_y as usize * bg_w as usize + dst_x as usize) * 4;
                for c in 0..3 {
                    let p00 = raw[(y0 as usize * row_bytes) + (x0 as usize * 3) + c] as f64;
                    let p10 = raw[(y0 as usize * row_bytes) + (x1 as usize * 3) + c] as f64;
                    let p01 = raw[(y1 as usize * row_bytes) + (x0 as usize * 3) + c] as f64;
                    let p11 = raw[(y1 as usize * row_bytes) + (x1 as usize * 3) + c] as f64;
                    let v = p00 * (1.0 - dx) * (1.0 - dy)
                        + p10 * dx * (1.0 - dy)
                        + p01 * (1.0 - dx) * dy
                        + p11 * dx * dy;
                    scalar[off + c] = v.round() as u8;
                }
                scalar[off + 3] = 255;
            }
        }

        assert_eq!(parallel, scalar, "并行 warp 与单线程结果应逐字节一致");
    }
}