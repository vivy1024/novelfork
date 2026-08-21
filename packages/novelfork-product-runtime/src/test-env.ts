import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const testRoot = mkdtempSync(join(tmpdir(), "novelfork-product-runtime-test-"));
const projectRoot = join(testRoot, "project");
const booksRoot = join(projectRoot, "books");
mkdirSync(booksRoot, { recursive: true });

// Bridge imports can initialize Runtime modules while test files are evaluated.
// Set every product-owned path before those imports so tests never lock or mutate
// a developer's ~/.narrafork or ~/.novelfork data.
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

