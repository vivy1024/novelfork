/**
 * URL 协议补全工具。
 *
 * 与 NarraFork 原生 `frontend/lib/url.ts` 的 `normalizeUrlProtocol` 行为对齐：
 * 作者在 Hook 里填 `example.com/hook` 这种裸主机名时，Runtime 的 zod
 * `z.string().url()` 会直接 400。原生在提交前补全协议，这里沿用同一套规则，
 * 否则同一个 Hook 在原生前端能存、在 shadcn 前端报错。
 */

const URL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-z]:[\\/]/i;

function isValidIpv4Address(value: string): boolean {
	const parts = value.split(".");
	if (parts.length !== 4) return false;
	return parts.every((part) => {
		if (!/^\d+$/.test(part)) return false;
		const number = Number(part);
		return number >= 0 && number <= 255 && String(number) === part;
	});
}

function isValidIpv6Address(value: string): boolean {
	if (!value.includes(":")) return false;
	try {
		new URL(`http://[${value}]`);
		return true;
	} catch {
		return false;
	}
}

function splitAuthority(candidate: string): { authority: string; suffix: string } | null {
	const match = /^(?<authority>[^/?#]*)(?<suffix>[/?#].*)?$/s.exec(candidate);
	const authority = match?.groups?.authority;
	if (!authority) return null;
	return { authority, suffix: match?.groups?.suffix ?? "" };
}

function normalizeBareIpv6Candidate(candidate: string): string | null {
	const parts = splitAuthority(candidate);
	if (!parts?.authority.includes(":")) return null;
	if (parts.authority.includes("@") || parts.authority.includes("[")) return null;
	if (!isValidIpv6Address(parts.authority)) return null;
	return `[${parts.authority}]${parts.suffix}`;
}

function parseHttpCandidate(candidate: string): URL | null {
	try {
		return new URL(`http://${candidate}`);
	} catch {
		return null;
	}
}

function shouldSkipProtocolCompletion(value: string): boolean {
	return (
		/[\s\\]/.test(value) ||
		WINDOWS_ABSOLUTE_PATH_RE.test(value) ||
		(value.startsWith("/") && !value.startsWith("//")) ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.startsWith("?") ||
		value.startsWith("#")
	);
}

export function normalizeUrlProtocol(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (URL_PROTOCOL_RE.test(trimmed)) return trimmed;
	if (shouldSkipProtocolCompletion(trimmed)) return trimmed;

	const candidate = trimmed.startsWith("//") ? trimmed.slice(2) : trimmed;
	const ipv6Candidate = normalizeBareIpv6Candidate(candidate);
	if (ipv6Candidate) return `http://${ipv6Candidate}`;

	const parsed = parseHttpCandidate(candidate);
	if (!parsed) return trimmed;

	const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (hostname === "localhost" || isValidIpv4Address(hostname) || isValidIpv6Address(hostname)) {
		return `http://${candidate}`;
	}

	return `https://${candidate}`;
}
