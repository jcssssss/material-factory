use image::{DynamicImage, ImageBuffer, Rgba};
use tauri::command;

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

/// 对单通道进行双线性采样（坐标已 clamp 到有效范围）。
fn sample_bilinear(
    src: &ImageBuffer<Rgba<u8>, Vec<u8>>,
    sx: f64,
    sy: f64,
) -> Rgba<u8> {
    let w = src.width() as f64;
    let h = src.height() as f64;

    let sx = sx.clamp(0.0, w - 1.0);
    let sy = sy.clamp(0.0, h - 1.0);

    let x0 = sx.floor() as u32;
    let y0 = sy.floor() as u32;
    let x1 = (x0 + 1).min(src.width() - 1);
    let y1 = (y0 + 1).min(src.height() - 1);
    let dx = sx - x0 as f64;
    let dy = sy - y0 as f64;

    let p00 = src.get_pixel(x0, y0);
    let p10 = src.get_pixel(x1, y0);
    let p01 = src.get_pixel(x0, y1);
    let p11 = src.get_pixel(x1, y1);

    let mut out = [0u8; 4];
    for c in 0..4 {
        let v = p00[c] as f64 * (1.0 - dx) * (1.0 - dy)
            + p10[c] as f64 * dx * (1.0 - dy)
            + p01[c] as f64 * (1.0 - dx) * dy
            + p11[c] as f64 * dx * dy;
        out[c] = v.round() as u8;
    }
    Rgba(out)
}

/// 应用 Homography，将源图像透视变形到目标画布上。
fn warp_perspective(
    src: &ImageBuffer<Rgba<u8>, Vec<u8>>,
    h: &[f64; 9],
    bg_w: u32,
    bg_h: u32,
) -> ImageBuffer<Rgba<u8>, Vec<u8>> {
    let mut out = ImageBuffer::from_pixel(bg_w, bg_h, Rgba([0, 0, 0, 0]));

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

            if src_x >= 0.0
                && src_x < src.width() as f64
                && src_y >= 0.0
                && src_y < src.height() as f64
            {
                let pixel = sample_bilinear(src, src_x, src_y);
                out.put_pixel(dst_x, dst_y, pixel);
            }
        }
    }

    out
}

#[command]
pub fn warp_to_a4(
    material_bytes: Vec<u8>,
    bg_w: u32,
    bg_h: u32,
    corners: [f64; 8],
) -> Result<Vec<u8>, String> {
    let source = image::load_from_memory(&material_bytes)
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

    let source_rgba = source.to_rgba8();
    let warped = warp_perspective(&source_rgba, &h, bg_w, bg_h);

    let warped_dynamic = DynamicImage::ImageRgba8(warped);
    let mut output = Vec::new();
    warped_dynamic
        .write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Png)
        .map_err(|e| format!("编码 PNG 失败：{e}"))?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_sample_bilinear_center() {
        let mut img = ImageBuffer::new(3, 3);
        img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        img.put_pixel(1, 1, Rgba([0, 255, 0, 255]));
        img.put_pixel(2, 2, Rgba([0, 0, 255, 255]));
        let pixel = sample_bilinear(&img, 1.0, 1.0);
        assert_eq!(pixel[0], 0);
        assert_eq!(pixel[1], 255);
        assert_eq!(pixel[2], 0);
    }

    #[test]
    fn test_sample_bilinear_clamp() {
        let mut img = ImageBuffer::new(2, 2);
        img.put_pixel(0, 0, Rgba([10, 20, 30, 255]));
        img.put_pixel(1, 0, Rgba([40, 50, 60, 255]));
        img.put_pixel(0, 1, Rgba([70, 80, 90, 255]));
        img.put_pixel(1, 1, Rgba([100, 110, 120, 255]));
        let pixel = sample_bilinear(&img, -1.0, -1.0);
        assert_eq!(pixel[0], 10);
        assert_eq!(pixel[1], 20);
    }

    #[test]
    fn test_warp_perspective_output_size() {
        let src = ImageBuffer::from_pixel(10, 10, Rgba([255, 0, 0, 255]));
        let h = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let out = warp_perspective(&src, &h, 20, 20);
        assert_eq!(out.width(), 20);
        assert_eq!(out.height(), 20);
        let center = out.get_pixel(5, 5);
        assert_eq!(center[0], 255);
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
        let result = warp_to_a4(png_bytes, 20, 20, corners).unwrap();
        assert_eq!(&result[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
    }

    #[test]
    fn test_warp_to_a4_invalid_image() {
        let corners: [f64; 8] = [0.0, 0.0, 0.5, 0.0, 0.5, 0.5, 0.0, 0.5];
        let result = warp_to_a4(vec![0, 1, 2, 3], 20, 20, corners);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("解码资料图片失败"));
    }
}
