import { fetchJson } from "../../hooks/use-api";
import { createContractClient, type ContractClient } from "./contract-client";

export type FetchJsonLike = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createFetchJsonContractClient(fetchJsonImpl: FetchJsonLike = fetchJson): ContractClient {
  return createContractClient({
    fetch: async (input, init) => {
      const path = String(input);
      try {
        return jsonResponse(await callFetchJson(fetchJsonImpl, path, compactFetchJsonInit(init)));
      } catch (error) {
        const status = statusFromError(error);
        return new Response(JSON.stringify(errorEnvelope(error)), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
    },
  });
}

export function createLenientFetchJsonContractClient(fetchJsonImpl: FetchJsonLike = fetchJson): ContractClient {
  return createContractClient({
    fetch: async (input, init) => {
      const path = String(input);
      try {
        return jsonResponse(await callFetchJson(fetchJsonImpl, path, compactFetchJsonInit(init)));
      } catch (error) {
        const status = statusFromError(error);
        return new Response(JSON.stringify(errorEnvelope(error)), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
    },
  });
}

function callFetchJson<T>(fetchJsonImpl: FetchJsonLike, path: string, init?: RequestInit): Promise<T> {
  return init === undefined ? fetchJsonImpl<T>(path) : fetchJsonImpl<T>(path, init);
}

function jsonResponse(data: unknown): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function compactFetchJsonInit(init?: RequestInit): RequestInit | undefined {
  if (!init) return undefined;
  const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
  const hasHeaders = [...headers.keys()].length > 0;
  const method = init.method?.toUpperCase();
  if ((method === undefined || method === "GET") && !hasHeaders && !init.body && !init.signal) {
    return undefined;
  }
  return init;
}

function statusFromError(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function errorEnvelope(error: unknown): { error: { message: string; code?: string } } {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    const code = typeof errorWithCode.code === "string" ? errorWithCode.code : undefined;
    return { error: { message: error.message, ...(code ? { code } : {}) } };
  }
  return { error: { message: String(error) } };
}
