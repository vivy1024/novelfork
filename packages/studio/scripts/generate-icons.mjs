import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, "../public/icons");

await mkdir(iconsDir, { recursive: true });

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Create a simple PNG with base64 encoded 1x1 blue pixel, then scale
// For production, replace with actual designed icons
const createPlaceholderPNG = (size) => {
  // Minimal PNG: blue square
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#3b82f6"/>
  <text x="50%" y="50%" font-size="${Math.floor(size / 4)}" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-weight="bold">NovelFork</text>
</svg>`;
  return Buffer.from(svg);
};

for (const size of sizes) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#3b82f6"/>
  <text x="50%" y="50%" font-size="${Math.floor(size / 4)}" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-weight="bold">NovelFork</text>
</svg>`;

  // Save as SVG (browsers can use SVG as PWA icons)
  writeFileSync(resolve(iconsDir, `icon-${size}x${size}.svg`), svg);

  // Also create a minimal PNG placeholder using data URL approach
  // This is a 1x1 blue pixel PNG in base64
  const bluePNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
    "base64"
  );
  writeFileSync(resolve(iconsDir, `icon-${size}x${size}.png`), bluePNG);

  console.log(`Generated icon-${size}x${size}.svg and .png`);
}

console.log("\nPlaceholder icons generated!");
console.log("Note: PNG files are 1x1 placeholders. For production:");
console.log("  1. Design proper icons in Figma/Illustrator");
console.log("  2. Export as PNG at each size");
console.log("  3. Replace files in public/icons/");
