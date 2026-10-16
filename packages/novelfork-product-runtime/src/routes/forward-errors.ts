import type { Env, Hono, Schema } from "hono";

/**
 * 让产品子应用的异常交回 Runtime 父应用的 onError 统一序列化。
 *
 * 产品包与 Runtime 各装一份 hono（版本不同）。Hono.route() 只在子应用仍用「本副本的默认 errorHandler」时
 * 才直接复用子路由；两份副本的默认处理器不是同一个函数，于是父应用会用子应用自己的默认处理器包一层，
 * 子路由抛出的 ValidationError / NotFoundError 被吞成纯文本 500，父应用的 JSON 错误契约失效。
 * 同版本组合（单元测试里常见）测不出这个问题。
 *
 * 把子应用的 onError 设为「原样重新抛出」，异常就会冒泡到父应用的 compose，由父应用 onError 处理；
 * 父子同一份 hono 时行为也不变。泛型放宽到任意 Env，带 Variables 的子应用（如 user）也能直接包装。
 */
export function forwardErrorsToParent<E extends Env, S extends Schema, B extends string>(
	app: Hono<E, S, B>,
): Hono<E, S, B> {
	app.onError((error) => {
		throw error;
	});
	return app;
}
