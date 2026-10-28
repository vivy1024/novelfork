import { AppError, NotFoundError } from "@vivy1024/narrafork-runtime-bridge";
import { ownsBookBinding } from "../policy/book-product-policy";
import { bookRuntimeBindingService } from "./book-binding";

export type BookProjectActor = { userId: string; role: "admin" | "user" };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 书项目上允许直接走 Runtime 的写请求：只有画布节点位置这类纯布局状态，
 * 不碰项目行、成员、git 历史与书目录。其余写请求一律视为书项目变更（fail-closed），
 * Runtime 上游以后新增的 `/api/projects/:id/*` 写端点默认也被拦下。
 */
const LAYOUT_ONLY_WRITES: ReadonlyArray<readonly [method: string, suffix: string]> = [
	["PATCH", "/graph/positions"],
	["PATCH", "/ruler/positions"],
];

const PROJECT_PATH = /^\/api\/projects\/[^/]+(\/.*)?$/u;

/**
 * 是否是会改变书的 Runtime 项目的请求：删除项目、改项目元数据、可见性、成员、转让 owner、
 * 备份写盘、Ruler 的分叉/合并/变基/放弃等。只按方法与 `:id` 之后的路径判断，
 * 不比对解码后的 id，避免编码差异让判断失效。
 */
export function isBookProjectMutation(method: string, path: string, _projectId: string): boolean {
	const normalizedMethod = method.toUpperCase();
	if (READ_METHODS.has(normalizedMethod)) return false;
	const match = PROJECT_PATH.exec(path);
	if (!match) return false;
	const suffix = match[1] ?? "";
	return !LAYOUT_ONLY_WRITES.some(([allowedMethod, allowedSuffix]) => allowedMethod === normalizedMethod && allowedSuffix === suffix);
}

/**
 * 书的 Runtime 项目只能经产品入口删除或调整：绕过产品层删项目，书的绑定会指向一个已不存在的项目，
 * 产品库数据和书目录也不会随之清理；改成员或转让 owner 会让书的归属与 Runtime 项目脱节。
 * 管理员同样走产品入口（产品的删书、认领、修复对管理员都可用），这里不开后门。
 * 没有绑定书的普通 Runtime 项目直接放行。
 */
export async function assertBookProjectMutationAllowed(actor: BookProjectActor, projectId: string): Promise<void> {
	const binding = await bookRuntimeBindingService.getByProjectId(projectId);
	if (!binding) return;
	// 与 Runtime 自己的项目 ACL 一致：看不到的项目一律当作不存在，不透露它是一本书。
	if (!ownsBookBinding(actor, binding.createdByUserId)) throw new NotFoundError("Project", projectId);
	throw new AppError(
		[
			"发生了什么：这个 Runtime 项目属于 NovelFork 的一本作品，不能在 Runtime 的项目页面直接删除或修改（包括成员、可见性、归属人和项目设置），本次请求没有改动任何内容。",
			"为什么要看：直接改动会让作品与它的 Runtime 项目脱节，作品还在书架上却找不到对应的项目，章节和设定数据也不会一起清理。",
			"建议怎么做：要删除作品，请在 NovelFork「我的作品」里使用「删除作品」；要调整作品信息，请使用作品的「本书设置」。",
		].join("\n"),
		403,
		"BOOK_PROJECT_PROTECTED",
	);
}
