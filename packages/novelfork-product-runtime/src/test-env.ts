import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const testRoot = mkdtempSync(join(tmpdir(), "novelfork-product-runtime-test-"));
// 更换本地目录不会隔离外部 PostgreSQL，默认测试不能继承宿主连接目标。
process.env.NF_DATABASE_BACKEND = "sqlite";
for (const name of ["NF_DATABASE_URL", "DATABASE_URL", "NF_READ_BACKEND", "NF_WRITE_BACKEND"]) {
	delete process.env[name];
}
const projectRoot = join(testRoot, "project");
const booksRoot = join(projectRoot, "books");
mkdirSync(booksRoot, { recursive: true });

// Bridge imports can initialize Runtime modules while test files are evaluated.
// Set every product-owned path before those imports so tests never lock or mutate
// a developer's ~/.narrafork or ~/.novelfork data.
// 产品代码先看 NOVELFORK_HOME 再看 homedir()，开发者自己的值可能指向真实数据，这里同样要覆盖。
process.env.NOVELFORK_HOME = join(testRoot, "home");
process.env.NARRAFORK_HOME = join(testRoot, "runtime");
process.env.NARRAFORK_MIGRATIONS_DIR = resolve(
	import.meta.dir,
	"..",
	"..",
	"narrafork-runtime-private",
	"runtime-migrations",
);
process.env.NOVELFORK_STORAGE_DB_PATH = join(testRoot, "novelfork.db");
process.env.NOVELFORK_SESSION_STORE_DIR = join(testRoot, "sessions");
process.env.NOVELFORK_PROJECT_ROOT = projectRoot;
process.env.NOVELFORK_BOOKS_ROOT = booksRoot;

