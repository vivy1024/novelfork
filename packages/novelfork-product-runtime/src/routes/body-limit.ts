import type { Context, Hono, MiddlewareHandler } from "hono";

/**
 * 产品路由的请求体上限（T-11）。
 *
 * 只作用于产品路径（见 PRODUCT_PATH_PREFIXES），Runtime 自己的大体积路由（上传等）不受影响。
 * - 默认 2 MiB：书籍、章节、配置等接口只收小结构 JSON。
 * - 长文本入口 8 MiB：文风蒸馏（最多 100 万字，UTF-8 下约 3 MB，外加 JSON 包装）、
 *   经纬批量导入、写作技能导入、作品文本导入。
 * - 档案导入 256 MiB：与 novel-plugin routes/book-archive.ts 自身的 256 MB 校验一致，不再豁免。
 *
 * 有 Content-Length 时按声明长度直接判定；没有（分块上传）时先在上限内把请求体读完，
 * 超限立即 413，处理函数根本看不到半截请求体——很多处理函数用 `c.req.json().catch(() => null)`
 * 读体，会把流中断的错误吞掉，若交给它们自己读，超限请求会被当成空体继续执行。
 */

const MiB = 1024 * 1024;

export const PRODUCT_BODY_LIMIT_BYTES = 2 * MiB;
export const LONG_TEXT_BODY_LIMIT_BYTES = 8 * MiB;
/** 与 novel-plugin 的 MAX_BOOK_ARCHIVE_UPLOAD_BYTES 相同（测试核对两者一致）。 */
export const ARCHIVE_IMPORT_BODY_LIMIT_BYTES = 256 * MiB;

export const ARCHIVE_IMPORT_PATH = "/api/novelfork/book-archives/import";

/**
 * 产品挂在 Runtime 上的全部路径前缀（以 index.ts / domain.ts 的实际挂载为准）。
 * 新增产品前缀时要加到这里；body-limit.test.ts 会遍历产品路由表，漏掉的前缀会让测试失败。
 */
export const PRODUCT_PATH_PREFIXES = [
	"/api/novelfork",
	"/api/books",
	"/api/novel",
	"/api/plugins/bundled",
	"/api/product",
	"/api/filter",
	"/api/compliance",
	"/api/writing-skills",
	"/api/market",
	"/api/embedding",
	"/api/settings/zhuque",
	"/api/works",
	"/api/style",
] as const;

/** 放宽到 8 MiB 的长文本入口。 */
const LONG_TEXT_PATHS: readonly RegExp[] = [
	/^\/api\/books\/[^/]+\/style\/distillations(?:\/|$)/u,
	/^\/api\/books\/[^/]+\/style\/distill$/u,
	/^\/api\/books\/[^/]+\/jingwei\/import$/u,
	/^\/api\/writing-skills\/import$/u,
	/^\/api\/works\/import$/u,
];

function isUnder(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/** 返回该路径适用的请求体上限（字节）；不是产品路径时返回 null（不限制）。 */
export function resolveProductBodyLimit(path: string): number | null {
	if (!PRODUCT_PATH_PREFIXES.some((prefix) => isUnder(path, prefix))) return null;
	if (path === ARCHIVE_IMPORT_PATH) return ARCHIVE_IMPORT_BODY_LIMIT_BYTES;
	if (LONG_TEXT_PATHS.some((pattern) => pattern.test(path))) return LONG_TEXT_BODY_LIMIT_BYTES;
	return PRODUCT_BODY_LIMIT_BYTES;
}

function formatLimit(bytes: number): string {
	return `${Math.round(bytes / MiB)} MiB`;
}

function tooLarge(c: Context, limit: number): Response {
	return c.json(
		{
			error: `请求体超过 ${formatLimit(limit)} 上限。`,
			code: "PAYLOAD_TOO_LARGE",
			limitBytes: limit,
			explanation: {
				whatHappened: `这次请求的内容超过了该接口 ${formatLimit(limit)} 的大小上限，已被拒绝，没有做任何处理。`,
				whyItMatters: "超大的请求体会占满服务内存，拖慢甚至拖垮正在写作的其他会话，所以每个接口都有上限。",
				suggestedAction:
					limit >= ARCHIVE_IMPORT_BODY_LIMIT_BYTES
						? "档案过大：请拆分作品或去掉不需要的模块后重新导出、再导入。"
						: "请把内容拆成几次提交（例如分批导入、分段蒸馏），或精简后重试。",
			},
		},
		413,
	);
}

function declaredLength(c: Context): number | null {
	if (c.req.raw.headers.has("transfer-encoding")) return null;
	const header = c.req.raw.headers.get("content-length");
	if (header === null || !/^\d+$/u.test(header.trim())) return null;
	return Number(header.trim());
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/** 只对产品路径生效的请求体上限中间件；挂在任何路径上都不会影响 Runtime 自己的路由。 */
export function productBodyLimit(): MiddlewareHandler {
	return async (c, next) => {
		const limit = resolveProductBodyLimit(c.req.path);
		const body = c.req.raw.body;
		if (limit === null || !body) {
			await next();
			return;
		}
		const declared = declaredLength(c);
		if (declared !== null) {
			if (declared > limit) return tooLarge(c, limit);
			await next();
			return;
		}
		// 没有可信的 Content-Length（分块上传）：在上限内先读完，超限立即中止。
		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => undefined);
				return tooLarge(c, limit);
			}
			chunks.push(value);
		}
		c.req.raw = new Request(c.req.raw, { body: concat(chunks, total), duplex: "half" } as RequestInit);
		await next();
	};
}

/**
 * 在 Runtime 应用上挂产品请求体上限（index.ts 的 mountAuthenticatedGuards 调用）。
 * 统一挂在 /api/*，由 resolveProductBodyLimit 判定是否属于产品路径，避免按前缀逐个挂载时漏挂或重复执行。
 */
export function mountProductBodyLimit(app: Hono): void {
	app.use("/api/*", productBodyLimit());
}
