import { runtimeJson } from "../runtime/auth";
import { buildBookProductPath } from "../runtime/product-contract";
import type { ToolResultAction } from "./types";

const HOST_OWNED_FIELDS = ["bookId", "bookRoot", "sessionId"] as const;

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Host-owned follow-up from a tool-result card.
 * book.dissect 确认走现有 lore.write stagingDecision，不另开第三套工具。
 */
export async function executeToolResultAction(
  bookId: string,
  action: ToolResultAction,
): Promise<unknown> {
  const boundBookId = bookId.trim();
  if (!boundBookId) throw new Error("缺少可信的书籍绑定。");
  if (action.type !== "lore.write.staging") {
    throw new Error("不支持的结果卡操作。");
  }
  if (action.toolName !== "lore.write" && action.toolName !== "jingwei.write") {
    throw new Error("拆书确认必须走 lore.write。");
  }
  for (const field of HOST_OWNED_FIELDS) {
    if (field in action.input) {
      throw new Error("bookId、sessionId 和 bookRoot 只能由宿主绑定。");
    }
  }
  const stagingId = asNonEmptyString(action.input.stagingId);
  const stagingDecision = action.input.stagingDecision === "promote" || action.input.stagingDecision === "reject"
    ? action.input.stagingDecision
    : "";
  if (!stagingId || !stagingDecision) {
    throw new Error("stagingId 和 stagingDecision 必须同时提供。");
  }
  return runtimeJson(buildBookProductPath(boundBookId, "jingwei", "staging", stagingId, "decision"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stagingDecision }),
  });
}
