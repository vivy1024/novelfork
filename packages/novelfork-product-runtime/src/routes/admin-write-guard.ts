import type { Context, MiddlewareHandler } from "hono";
import { AppError, requireAdmin } from "@vivy1024/narrafork-runtime-bridge";

/**
 * 全局写接口的管理员守卫（T-04）。
 *
 * 这些接口改的是进程级 / 产品库级的全局配置，影响所有书与所有用户，而不是某本书：
 * 朱雀检测地址与密钥、合规词典、市场榜单与词表、向量模型配置、全局写作技能、内置插件安装。
 * 规则只按「方法 + 路径前缀」判定：GET / HEAD / OPTIONS 照常放行（读取脱敏信息），
 * 其余方法（含 PATCH 等任何新增写法）一律要求管理员会话。
 *
 * 身份判定复用 Runtime 的 requireAdmin（OAuth 令牌即使属于管理员也不放行），
 * 只把它抛出的 401/403 换成带三段式 explanation 的 JSON，前端与叙述者直接展示说明。
 */

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 只许管理员写的全局路径（Hono 路径模式；`/x/*` 也匹配 `/x` 本身）。
 * 书籍作用域的接口（/api/books/:bookId/...）由书籍访问控制负责，不在此列。
 */
export const ADMIN_ONLY_WRITE_PATHS = [
	"/api/settings/zhuque",
	"/api/compliance/*",
	"/api/market/*",
	"/api/embedding/*",
	"/api/writing-skills/*",
] as const;

export function isReadMethod(method: string): boolean {
	return READ_METHODS.has(method.toUpperCase());
}

function deniedResponse(c: Context, error: AppError): Response {
	const unauthenticated = error.statusCode === 401;
	const status = unauthenticated ? 401 : 403;
	return c.json(
		{
			error: unauthenticated ? "需要登录后才能修改全局配置。" : "只有管理员可以修改全局配置。",
			code: unauthenticated ? error.code : "ADMIN_REQUIRED",
			explanation: {
				whatHappened: unauthenticated
					? "这次修改全局配置的请求没有有效的登录会话，已被拦下，配置没有改动。"
					: "这次请求要修改全站共用的配置（如检测服务、合规词典、市场数据、向量模型、全局技能或内置插件），当前账号不是管理员，已被拦下，配置没有改动。",
				whyItMatters:
					"这类配置对所有作品和所有用户同时生效；允许普通账号修改，会让一个人的改动影响到其他人的写作与数据，甚至把正文或密钥发往不受信任的地址。",
				suggestedAction: unauthenticated
					? "重新登录后再试；若用的是第三方应用令牌，请改用 NovelFork 网页登录的管理员账号操作。"
					: "请联系管理员代为修改（第三方应用令牌即使属于管理员也不能改全局配置，需用网页登录的管理员账号）；只想查看当前配置时，读取接口不受影响。",
			},
		},
		status,
	);
}

/**
 * 当前请求是否来自管理员会话；不是时返回带 explanation 的 401/403 响应，是时返回 null。
 * 供不便挂中间件的路由（如内置插件安装，路由表需保持精确清单）在处理函数开头调用。
 */
export async function denyUnlessAdmin(c: Context): Promise<Response | null> {
	try {
		await requireAdmin(c, async () => undefined);
		return null;
	} catch (error) {
		if (error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403)) {
			return deniedResponse(c, error);
		}
		throw error;
	}
}

/** 非读请求一律要求管理员；读请求直接放行。 */
export const requireAdminForWrites: MiddlewareHandler = async (c, next) => {
	if (isReadMethod(c.req.method)) {
		await next();
		return;
	}
	const denied = await denyUnlessAdmin(c);
	if (denied) return denied;
	await next();
};
