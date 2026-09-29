import { describe, expect, it } from "vitest";
import { ApiRequestError, fetchJson } from "./api-client";

function respond(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;
}

async function failure(body: unknown, status = 422): Promise<ApiRequestError> {
  try {
    await fetchJson("/api/test", {}, { fetchImpl: respond(status, body) });
  } catch (error) {
    if (error instanceof ApiRequestError) return error;
    throw error;
  }
  throw new Error("expected failure");
}

describe("fetchJson 错误信息", () => {
  it("三段式解释对象取「发生了什么 + 建议怎么做」，并保留错误码", async () => {
    const error = await failure({
      ok: false,
      code: "MODEL_NOT_CONFIGURED",
      explanation: { whatHappened: "第 3 章没有重新结算。", whyItMatters: "结算要靠模型。", suggestedAction: "到设置里选择默认模型。" },
    });
    expect(error.message).toBe("第 3 章没有重新结算。 到设置里选择默认模型。");
    expect(error.code).toBe("MODEL_NOT_CONFIGURED");
    expect(error.status).toBe(422);
  });

  it("字符串解释与 error 标题照旧拼接", async () => {
    const error = await failure({ error: "套路不存在", explanation: "该套路已被删除。" }, 404);
    expect(error.message).toBe("套路不存在：该套路已被删除。");
  });

  it("没有可读信息时退回状态码", async () => {
    const error = await failure({}, 500);
    expect(error.message).toMatch(/^500/);
  });
});
