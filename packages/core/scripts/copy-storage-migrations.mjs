import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sourceDir = join(packageRoot, "src", "storage", "migrations");
const targetDir = join(packageRoot, "dist", "storage", "migrations");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
