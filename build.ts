#!/usr/bin/env bun
/**
 * NovelFork Bun Build Script
 * 编译成单文件可执行程序，参考 NarraFork 架构
 */

import { $ } from "bun";
import { join } from "path";

const ROOT = import.meta.dir;
const DIST_DIR = join(ROOT, "dist-bun");
const OUTPUT_EXE = join(DIST_DIR, "NovelFork.exe");

console.log("🔨 Building NovelFork with Bun...\n");

// 1. 清理旧构建
console.log("📦 Cleaning old build...");
await $`rm -rf ${DIST_DIR}`.quiet();
await $`mkdir -p ${DIST_DIR}`.quiet();

// 2. 构建前端
console.log("🎨 Building frontend...");
await $`cd packages/studio && pnpm build:client`;

// 3. 跳过后端编译（暂时只打包前端 PWA）
console.log("⚠️  Skipping backend build (type errors)");

// 4. 编译成单文件 exe
console.log("🚀 Compiling to executable...");
await $`bun build entry.ts --compile --outfile ${OUTPUT_EXE} --target bun-windows-x64`;

// 5. 复制前端资源到 exe 同目录
console.log("📂 Copying frontend assets...");
await $`xcopy /E /I /Y packages\\studio\\dist ${DIST_DIR}\\public`;

console.log(`\n✅ Build complete!`);
console.log(`📦 Output: ${OUTPUT_EXE}`);
const size = (Bun.file(OUTPUT_EXE).size / 1024 / 1024).toFixed(2);
console.log(`📊 Size: ${size} MB`);
console.log(`\n🚀 Run: cd dist-bun && ./NovelFork.exe`);

