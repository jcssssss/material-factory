// 使用 node-canvas 将 SVG 渲染为多尺寸 PNG。
// node-canvas 的 Image 对象支持加载 SVG（依赖底层 librsvg）。
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const SVG_PATH = path.join(__dirname, "option_e5_bright_rings.svg");
const OUTPUT_DIR = path.join(__dirname, "rendered");

// 需要生成的尺寸（基础 PNG，再用 tauri icon 生成全套）
const SIZES = [16, 32, 64, 128, 256, 512, 1024];

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const svgBuffer = fs.readFileSync(SVG_PATH);
  console.log(`已加载 SVG: ${SVG_PATH} (${svgBuffer.length} bytes)`);

  // 测试：用 loadImage 加载 SVG，渲染到 512x512 canvas
  try {
    const image = await loadImage(svgBuffer);
    console.log(`SVG 加载成功，原始尺寸: ${image.width}x${image.height}`);

    for (const size of SIZES) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext("2d");
      // 高质量缩放
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, size, size);

      const outPath = path.join(OUTPUT_DIR, `${size}x${size}.png`);
      const buf = canvas.toBuffer("image/png");
      fs.writeFileSync(outPath, buf);
      console.log(`  生成: ${outPath} (${buf.length} bytes)`);
    }

    // 额外生成 128x128@2x (256x256) 命名
    const at2x = path.join(OUTPUT_DIR, "128x128@2x.png");
    fs.copyFileSync(path.join(OUTPUT_DIR, "256x256.png"), at2x);
    console.log(`  生成: ${at2x}`);

    // icon.png (512x512)
    const iconPng = path.join(OUTPUT_DIR, "icon.png");
    fs.copyFileSync(path.join(OUTPUT_DIR, "512x512.png"), iconPng);
    console.log(`  生成: ${iconPng}`);

    // source_1024.png 作为 tauri icon 命令的源
    const sourcePng = path.join(OUTPUT_DIR, "source_1024.png");
    fs.copyFileSync(path.join(OUTPUT_DIR, "1024x1024.png"), sourcePng);
    console.log(`  生成: ${sourcePng}`);

    console.log("\n所有尺寸 PNG 渲染完成！");
  } catch (err) {
    console.error("SVG 加载失败:", err.message);
    console.error("\n尝试方案 B：直接用 canvas API 手动绘制...");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("渲染失败:", err);
  process.exit(1);
});
