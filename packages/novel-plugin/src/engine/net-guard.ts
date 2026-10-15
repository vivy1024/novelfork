/**
 * 外部服务地址守卫（T-10）。
 *
 * 口径（作者 2026-10-15 决定，与 NarraFork 的模型供应商地址一致）：
 * - 协议白名单，所有外发地址都适用：只允许 http: / https:。Bun 的 fetch 会把
 *   `file:` 地址读成本机文件内容（POST 也一样，已用 Bun 1.4.2 复现），data:/blob:/ftp:
 *   同样不是网络服务，一律拒绝。
 * - 内网拒绝只用于第三方公网服务（朱雀检测）：地址不得指向内网、回环、链路本地、唯一本地、
 *   组播/保留段或云元数据地址，并在发请求前用 DNS 解析结果再核一次（防域名指向内网）。
 * - 向量模型地址由管理员配置，本地模型服务（Ollama、LM Studio 的 localhost）是正当用法，
 *   只做协议白名单，不做内网限制。
 *
 * 判定按网段进行，而不是按字符串匹配：URL 会把 IPv6 写法规范化，IPv4 映射（::ffff:a.b.c.d）、
 * IPv4 兼容（::a.b.c.d）、IPv4 转换（::ffff:0:a.b.c.d）、NAT64（64:ff9b::/96）与 6to4（2002::/16）
 * 必须还原成内嵌的 IPv4 再判断。
 *
 * 注意：本机代理的 fake-ip 网段 198.18.0.0/15 不算内网——开着代理时公网域名都解析到这里，
 * 拒绝它会让所有域名地址都不可用。
 *
 * 本模块会经 engine barrel 进入浏览器打包路径，不得引入任何 Node 内置模块；
 * DNS 解析由服务端调用方以 HostResolver 注入（见 routes/filter.ts）。
 */

import type { DiagnosticExplanation } from "../handlers/diagnostic-explanation.js";

const INTERNAL_V4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  [ipv4ToInt("0.0.0.0"), 8],
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("100.64.0.0"), 10],
  [ipv4ToInt("127.0.0.0"), 8],
  [ipv4ToInt("169.254.0.0"), 16],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16],
  // 组播 224.0.0.0/4 与保留段 240.0.0.0/4（含受限广播 255.255.255.255）。
  [ipv4ToInt("224.0.0.0"), 4],
  [ipv4ToInt("240.0.0.0"), 4],
];

function ipv4ToInt(address: string): number {
  const parts = address.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isInternalV4Int(value: number): boolean {
  return INTERNAL_V4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

const DOTTED_V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isDottedV4(host: string): boolean {
  const match = host.match(DOTTED_V4);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255));
}

/** 把两个 16 位分组还原成 IPv4 整数。 */
function hextetsToV4Int(high: number, low: number): number {
  return (((high & 0xffff) << 16) | (low & 0xffff)) >>> 0;
}

/**
 * 把 URL 规范化后的 IPv6 文本（小写、压缩、无点分尾段）展开成 8 个 16 位分组。
 * 不合规时返回 null，由调用方按「不可用」处理。
 */
function expandV6(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const values = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
    return values.some((value) => Number.isNaN(value)) ? null : values;
  };
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isInternalV6(host: string): boolean {
  const groups = expandV6(host);
  if (!groups) return true;
  const [g0, g1, g2, , g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  const embeddedV4 = hextetsToV4Int(g6, g7);
  const zeroPrefix = (count: number) => groups.slice(0, count).every((group) => group === 0);
  // :: 未指定、::1 回环。
  if (zeroPrefix(7) && (g7 === 0 || g7 === 1)) return true;
  // 唯一本地 fc00::/7、链路本地 fe80::/10、站点本地 fec0::/10（已废弃但仍可能被路由到内网）、组播 ff00::/8。
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xffc0) === 0xfec0) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  // IPv4 映射 ::ffff:a.b.c.d。
  if (zeroPrefix(5) && g5 === 0xffff) return isInternalV4Int(embeddedV4);
  // IPv4 兼容 ::a.b.c.d（URL 规范化后为 ::7f00:1 这类写法）。
  if (zeroPrefix(6)) return isInternalV4Int(embeddedV4);
  // IPv4 转换 ::ffff:0:a.b.c.d。
  if (zeroPrefix(4) && g4 === 0xffff && g5 === 0) return isInternalV4Int(embeddedV4);
  // NAT64 64:ff9b::/96 与本地用途 64:ff9b:1::/48（RFC 8215）。
  if (g0 === 0x64 && g1 === 0xff9b && (g2 === 0 || g2 === 1)) return isInternalV4Int(embeddedV4);
  // 6to4 2002:AABB:CCDD::/48 内嵌 IPv4。
  if (g0 === 0x2002) return isInternalV4Int(hextetsToV4Int(g1, g2));
  // Teredo 2001:0::/32：客户端 IPv4 按位取反存放在末 32 位。
  if (g0 === 0x2001 && g1 === 0) return isInternalV4Int((~embeddedV4) >>> 0);
  return false;
}

/** URL hostname 归一：小写、去方括号、去掉末尾的点（`localhost.` 与 `localhost` 是同一主机）。 */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

function parseUrl(endpoint: string): URL | null {
  try {
    return new URL(endpoint);
  } catch {
    return null;
  }
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

/** 协议白名单：只允许 http: / https:，解析失败的地址一律不合格。 */
export function isHttpEndpoint(endpoint: string): boolean {
  const url = parseUrl(endpoint);
  return url !== null && isHttpProtocol(url);
}

function isInternalHost(host: string): boolean {
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes(":")) return isInternalV6(host);
  if (isDottedV4(host)) return isInternalV4Int(ipv4ToInt(host));
  return false;
}

function isIpLiteral(host: string): boolean {
  return host.includes(":") || isDottedV4(host);
}

/**
 * 地址是否不可作为第三方公网服务使用：内网、回环、链路本地、唯一本地、组播/保留段与云元数据地址。
 * 解析失败或非 http(s) 协议（file:、data: 等）的地址一律视为不可用（返回 true），
 * 以免调用方把它当成「公网地址」放行。
 */
export function isInternalEndpoint(endpoint: string): boolean {
  const url = parseUrl(endpoint);
  if (!url || !isHttpProtocol(url)) return true;
  return isInternalHost(normalizeHostname(url.hostname));
}

/**
 * DNS 解析出的单个地址是否属于内网。接受未经 URL 规范化的写法（如 `::ffff:127.0.0.1`、
 * 带区域标识的 `fe80::1%12`）；无法识别的文本一律视为内网（不可用）。
 */
export function isInternalAddress(address: string): boolean {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed) return true;
  if (isDottedV4(trimmed)) return isInternalV4Int(ipv4ToInt(trimmed));
  if (!trimmed.includes(":")) return true;
  // 借 URL 解析器做 IPv6 规范化（点分尾段转十六进制、压缩写法统一）；带区域标识等非法写法会解析失败。
  const url = parseUrl(`http://[${trimmed}]/`);
  if (!url) return true;
  return isInternalV6(normalizeHostname(url.hostname));
}

/** 服务端注入的域名解析：返回该主机解析出的全部地址（node:dns 的 lookup(host, { all: true })）。 */
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export type EndpointRejectionReason = "invalid-url" | "protocol" | "internal" | "unresolvable" | "resolves-internal";

export type PublicEndpointCheck = { readonly ok: true } | { readonly ok: false; readonly reason: EndpointRejectionReason };

/**
 * 第三方公网服务地址的完整校验，保存配置与每次发请求前都要调用：
 * 协议白名单 → 字面内网地址 → DNS 解析结果逐个核对。域名在没有解析器、解析失败或
 * 解析结果为空时视为不可用（fail-closed）。
 *
 * 已知残余风险：校验与 fetch 之间各解析一次，DNS 重绑定仍有极短窗口；彻底消除需要把
 * 连接钉在校验过的 IP 上，Bun 的 fetch 目前不支持自定义 lookup。
 */
export async function checkPublicHttpEndpoint(endpoint: string, resolveHost?: HostResolver): Promise<PublicEndpointCheck> {
  const url = parseUrl(endpoint);
  if (!url) return { ok: false, reason: "invalid-url" };
  if (!isHttpProtocol(url)) return { ok: false, reason: "protocol" };
  const host = normalizeHostname(url.hostname);
  if (isInternalHost(host)) return { ok: false, reason: "internal" };
  if (isIpLiteral(host)) return { ok: true };
  if (!resolveHost) return { ok: false, reason: "unresolvable" };
  let addresses: readonly string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (addresses.length === 0) return { ok: false, reason: "unresolvable" };
  if (addresses.some((address) => isInternalAddress(address))) return { ok: false, reason: "resolves-internal" };
  return { ok: true };
}

/** 地址被拒时的三段式说明（发生了什么 / 为什么要看 / 建议怎么做），不回显地址本身。 */
export function explainEndpointRejection(reason: EndpointRejectionReason, service: string): DiagnosticExplanation {
  switch (reason) {
    case "invalid-url":
      return {
        whatHappened: `${service}的地址不是有效的网址，已拒绝使用。`,
        whyItMatters: "无法解析的地址既连不上服务，也无法判断它会把正文发到哪里。",
        suggestedAction: "填写完整的 https:// 开头的服务地址后重新保存。",
      };
    case "protocol":
      return {
        whatHappened: `${service}的地址不是 http 或 https 协议，已拒绝使用。`,
        whyItMatters: "file:、data: 等地址不是网络服务；其中 file: 会被当成本机文件读取，可能把本机文件内容泄露出去。",
        suggestedAction: "改用服务商提供的 https:// 开头的接口地址后重新保存。",
      };
    case "internal":
      return {
        whatHappened: `${service}的地址指向本机或内网，已拒绝使用。`,
        whyItMatters: "这是第三方公网服务；允许内网地址会让正文与密钥被发往本机或内网里的其他服务。",
        suggestedAction: "改用服务商提供的公网地址后重新保存。",
      };
    case "unresolvable":
      return {
        whatHappened: `${service}的域名当前无法解析，本次没有发出请求。`,
        whyItMatters: "解析不到地址时无法确认它不指向内网，为安全起见按不可用处理。",
        suggestedAction: "检查网络与代理设置、确认域名拼写正确后重试。",
      };
    case "resolves-internal":
      return {
        whatHappened: `${service}的域名解析到了本机或内网地址，已拒绝使用。`,
        whyItMatters: "域名指向内网时，请求会把正文与密钥送进内网服务，这正是要防的绕过方式。",
        suggestedAction: "确认填写的是服务商的官方公网域名；若本机 hosts 或 DNS 被改过，先修正再重试。",
      };
  }
}
