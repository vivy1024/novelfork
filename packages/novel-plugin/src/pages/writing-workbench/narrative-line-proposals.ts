/**
 * 叙事线 proposal 的唯一前端读写通道。
 *
 * 一次作者编辑固定是两步：先 propose 拿到预览与告警，再带审批结论 apply。
 * 抽出来的原因和 narrative-pending-events 一样 —— 叙事线视图、工作台和后续
 * 审批面板必须共用同一份实现，否则「删除是否生效」「告警是否展示」会在几处
 * 各自漂移。
 *
 * 服务端告警必须原样带回给作者：删除一个派生节点（章节/经纬）不会生效，
 * 如果前端吞掉 warnings，作者会以为删成功了。
 */

export interface NarrativeLineWarningData {
  readonly type?: string;
  readonly severity?: string;
  readonly summary?: string;
}

export interface NarrativeLinePreview {
  readonly id: string;
  readonly summary: string;
  readonly nodes?: readonly unknown[];
  readonly edges?: readonly unknown[];
  readonly removeNodeIds?: readonly string[];
  readonly removeEdgeIds?: readonly string[];
  readonly warnings?: readonly NarrativeLineWarningData[];
}

export interface NarrativeLineChangeRequest {
  readonly summary: string;
  readonly nodes?: readonly unknown[];
  readonly edges?: readonly unknown[];
  readonly removeNodeIds?: readonly string[];
  readonly removeEdgeIds?: readonly string[];
  readonly reason?: string;
}

/** 审批台账里的一条记录。批准与驳回都会留痕。 */
export interface NarrativeLineApproval {
  readonly previewId: string;
  readonly approvedAt: string;
  readonly summary: string;
  readonly decision?: "approved" | "rejected";
  readonly reason?: string;
  readonly targetNodeIds?: readonly string[];
  readonly targetEdgeIds?: readonly string[];
  readonly removedNodeIds?: readonly string[];
  readonly removedEdgeIds?: readonly string[];
  readonly checkpointId?: string;
}

export interface NarrativeLineChangeOutcome {
  readonly applied: boolean;
  /** 作者可读结论；失败时说明发生了什么以及下一步。 */
  readonly message: string;
  /** 成功时的附加提示（例如「有 1 条告警」），可直接拼在成功文案后。 */
  readonly notice: string;
  readonly warnings: readonly NarrativeLineWarningData[];
}

export type JsonFetch = (input: string, init?: RequestInit) => Promise<Response>;

function lineBase(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-line`;
}

/** 服务端拦截一律带 explanation；不要按 error code 自造文案。 */
async function explain(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as {
    explanation?: string;
    summary?: string;
    error?: string;
  };
  return payload.explanation ?? payload.summary ?? payload.error ?? `${fallback}（${response.status}）`;
}

/**
 * 读取叙事线审批台账。
 *
 * 服务端已记录每次批准与驳回，但在界面上一直看不到 —— 作者无法回答
 * 「这条节点是谁改的、什么时候批的、当时理由是什么」。
 */
export async function fetchNarrativeLineApprovals(
  bookId: string,
  options: { readonly limit?: number; readonly offset?: number; readonly fetchImpl?: JsonFetch } = {},
): Promise<readonly NarrativeLineApproval[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const queryParts: string[] = [];
  if (options.limit) queryParts.push(`limit=${encodeURIComponent(String(options.limit))}`);
  if (options.offset !== undefined && options.offset > 0) queryParts.push(`offset=${encodeURIComponent(String(options.offset))}`);
  const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
  const response = await doFetch(`${lineBase(bookId)}/approvals${query}`);
  if (!response.ok) throw new Error(await explain(response, "读取叙事线审批台账失败"));
  const payload = await response.json() as { approvals?: readonly NarrativeLineApproval[] };
  return payload.approvals ?? [];
}

export async function proposeNarrativeLineChange(
  bookId: string,
  request: NarrativeLineChangeRequest,
  options: { readonly fetchImpl?: JsonFetch } = {},
): Promise<NarrativeLinePreview> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${lineBase(bookId)}/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: request.summary,
      nodes: request.nodes ?? [],
      edges: request.edges ?? [],
      removeNodeIds: request.removeNodeIds ?? [],
      removeEdgeIds: request.removeEdgeIds ?? [],
      ...(request.reason ? { reason: request.reason } : {}),
    }),
  });
  if (!response.ok) throw new Error(await explain(response, "生成叙事线预览失败"));
  const payload = await response.json() as { preview?: NarrativeLinePreview };
  if (!payload.preview) throw new Error("服务端未返回叙事线预览，请重试。");
  return payload.preview;
}

export async function applyNarrativeLineChange(
  bookId: string,
  preview: NarrativeLinePreview,
  decision: "approved" | "rejected",
  options: { readonly reason?: string; readonly fetchImpl?: JsonFetch } = {},
): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${lineBase(bookId)}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      preview,
      decision,
      ...(options.reason ? { reason: options.reason } : {}),
    }),
  });
  if (!response.ok) throw new Error(await explain(response, "应用叙事线变更失败"));
}

/**
 * 直接编辑路径：propose → 展示告警 → apply。
 *
 * 作者在叙事线视图里的增删是显式动作，所以这里直接批准；但 warnings 会带回
 * 调用方展示。存在 warning 级告警时不静默应用 —— 那通常意味着这次删除对
 * 权威源无效，需要作者改到正确的地方处理。
 */
export async function submitNarrativeLineChange(
  bookId: string,
  request: NarrativeLineChangeRequest,
  options: { readonly fetchImpl?: JsonFetch } = {},
): Promise<NarrativeLineChangeOutcome> {
  const preview = await proposeNarrativeLineChange(bookId, request, options);
  const warnings = preview.warnings ?? [];
  const blocking = warnings.filter((warning) => warning.severity === "warning" || warning.severity === "critical");

  if (blocking.length > 0) {
    // 不静默落盘：把服务端说明交给作者，由作者决定下一步。
    await applyNarrativeLineChange(bookId, preview, "rejected", {
      ...options,
      reason: "预览存在阻断级告警，未自动应用",
    });
    return {
      applied: false,
      message: blocking.map((warning) => warning.summary ?? "存在无法执行的变更").join("；"),
      notice: "",
      warnings,
    };
  }

  await applyNarrativeLineChange(bookId, preview, "approved", options);
  return {
    applied: true,
    message: "",
    notice: warnings.length > 0 ? `（另有 ${warnings.length} 条提示）` : "",
    warnings,
  };
}
