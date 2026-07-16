#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const repoRoot = process.cwd();
const matrixPath = resolve(repoRoot, "contracts/novelfork-runtime-product-parity.json");
const errors: string[] = [];

const REQUIRED_CAPABILITY_IDS = [
  "bootstrap.current",
  "books.create",
  "books.status",
  "books.retry",
  "books.claim",
  "books.repair",
  "workspace.read",
  "workspace.create",
  "workspace.save",
  "narrator.list",
  "narrator.snapshot",
  "narrator.send",
  "narrator.interrupt",
  "narrator.permission",
  "narrator.compact",
  "ws.subscribe",
  "ws.catch-up",
  "ws.sync",
  "ws.full-reload",
  "studio.events.handled",
  "studio.events.metadata",
  "settings.current",
  "routines.current",
  "learning.deferred",
  "knowledge.deferred",
  "scheduled.deferred",
  "group.deferred",
  "global-search.deferred",
] as const;

const CAPABILITY_FIELDS = [
  "id",
  "domain",
  "phase",
  "status",
  "runtimeHttp",
  "runtimeWs",
  "productGateway",
  "studioConsumer",
  "featureFlag",
  "evidence",
  "notes",
] as const;

const ALLOWED_STATUSES = new Set(["verified", "partial", "deferred"]);
const FORBIDDEN_STUDIO_CONSUMERS = [
  { pattern: /\/api\/sessions(?:\/|\b)/i, label: "legacy /api/sessions" },
  { pattern: /\/api\/narrators(?:\/|\b)/i, label: "bare /api/narrators/:id" },
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describe(index: number, id: unknown): string {
  return `capabilities[${index}]${typeof id === "string" ? ` (${id})` : ""}`;
}

function requireNonEmptyString(value: unknown, field: string): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

function validateNullableString(value: unknown, field: string): void {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) {
    errors.push(`${field} must be null or a non-empty string`);
  }
}

function validateEvidencePath(filePath: string, field: string): void {
  if (isAbsolute(filePath)) {
    errors.push(`${field} must be repository-relative: ${filePath}`);
    return;
  }

  const absolutePath = resolve(repoRoot, filePath);
  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    errors.push(`${field} escapes the repository root: ${filePath}`);
    return;
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    errors.push(`${field} does not reference an existing file: ${filePath}`);
  }
}

function validateEvidence(value: unknown, field: string): { runtime: string[]; studio: string[] } | null {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object with runtime and studio arrays`);
    return null;
  }

  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "runtime,studio") {
    errors.push(`${field} must contain exactly runtime and studio`);
  }

  const result = { runtime: [] as string[], studio: [] as string[] };
  for (const kind of ["runtime", "studio"] as const) {
    const entries = value[kind];
    if (!Array.isArray(entries)) {
      errors.push(`${field}.${kind} must be an array`);
      continue;
    }
    entries.forEach((entry, index) => {
      if (!requireNonEmptyString(entry, `${field}.${kind}[${index}]`)) return;
      result[kind].push(entry);
      validateEvidencePath(entry, `${field}.${kind}[${index}]`);
    });
  }
  return result;
}

if (!existsSync(matrixPath)) {
  console.error("Runtime product parity verification failed:");
  console.error("- contracts/novelfork-runtime-product-parity.json does not exist");
  process.exit(1);
}

let document: unknown;
try {
  document = JSON.parse(readFileSync(matrixPath, "utf8"));
} catch (error) {
  console.error("Runtime product parity verification failed:");
  console.error(`- matrix is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!isRecord(document)) {
  errors.push("matrix root must be an object");
} else {
  if (!requireNonEmptyString(document.version, "version") || !/^\d+\.\d+\.\d+$/.test(document.version)) {
    if (typeof document.version === "string" && document.version.trim()) {
      errors.push("version must use numeric semver (for example 1.0.0)");
    }
  }

  const featureFlags = document.featureFlags;
  const knownFlags = new Set<string>();
  const envNames = new Set<string>();
  if (!isRecord(featureFlags) || Object.keys(featureFlags).length === 0) {
    errors.push("featureFlags must be a non-empty object");
  } else {
    for (const [name, rawFlag] of Object.entries(featureFlags)) {
      knownFlags.add(name);
      if (!isRecord(rawFlag)) {
        errors.push(`featureFlags.${name} must be an object`);
        continue;
      }
      const keys = Object.keys(rawFlag).sort();
      if (keys.join(",") !== "default,env") {
        errors.push(`featureFlags.${name} must contain exactly default and env`);
      }
      if (rawFlag.default !== false) {
        errors.push(`featureFlags.${name}.default must be false`);
      }
      if (requireNonEmptyString(rawFlag.env, `featureFlags.${name}.env`)) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(rawFlag.env)) {
          errors.push(`featureFlags.${name}.env must be an uppercase environment variable name`);
        }
        if (envNames.has(rawFlag.env)) {
          errors.push(`featureFlags environment variable is duplicated: ${rawFlag.env}`);
        }
        envNames.add(rawFlag.env);
      }
    }
  }

  const capabilities = document.capabilities;
  const seenIds = new Set<string>();
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    errors.push("capabilities must be a non-empty array");
  } else {
    capabilities.forEach((rawCapability, index) => {
      if (!isRecord(rawCapability)) {
        errors.push(`capabilities[${index}] must be an object`);
        return;
      }

      const label = describe(index, rawCapability.id);
      for (const field of CAPABILITY_FIELDS) {
        if (!(field in rawCapability)) errors.push(`${label} is missing ${field}`);
      }
      const unknownFields = Object.keys(rawCapability).filter(
        (field) => !CAPABILITY_FIELDS.includes(field as (typeof CAPABILITY_FIELDS)[number]),
      );
      if (unknownFields.length > 0) {
        errors.push(`${label} has unknown fields: ${unknownFields.join(", ")}`);
      }

      if (requireNonEmptyString(rawCapability.id, `${label}.id`)) {
        if (seenIds.has(rawCapability.id)) errors.push(`capability id is duplicated: ${rawCapability.id}`);
        seenIds.add(rawCapability.id);
      }
      requireNonEmptyString(rawCapability.domain, `${label}.domain`);
      requireNonEmptyString(rawCapability.phase, `${label}.phase`);
      const statusIsString = requireNonEmptyString(rawCapability.status, `${label}.status`);
      if (statusIsString && !ALLOWED_STATUSES.has(rawCapability.status)) {
        errors.push(`${label}.status must be verified, partial, or deferred`);
      }
      validateNullableString(rawCapability.runtimeHttp, `${label}.runtimeHttp`);
      validateNullableString(rawCapability.runtimeWs, `${label}.runtimeWs`);
      validateNullableString(rawCapability.productGateway, `${label}.productGateway`);
      validateNullableString(rawCapability.studioConsumer, `${label}.studioConsumer`);
      requireNonEmptyString(rawCapability.notes, `${label}.notes`);

      const evidence = validateEvidence(rawCapability.evidence, `${label}.evidence`);
      if (rawCapability.status === "verified" && evidence) {
        if (evidence.runtime.length === 0) errors.push(`${label} is verified but has no Runtime evidence`);
        if (evidence.studio.length === 0) errors.push(`${label} is verified but has no Studio evidence`);
      }

      validateNullableString(rawCapability.featureFlag, `${label}.featureFlag`);
      if (typeof rawCapability.featureFlag === "string") {
        if (!knownFlags.has(rawCapability.featureFlag)) {
          errors.push(`${label}.featureFlag references an unknown flag: ${rawCapability.featureFlag}`);
        }
        if (rawCapability.status === "deferred" && isRecord(featureFlags)) {
          const flag = featureFlags[rawCapability.featureFlag];
          if (!isRecord(flag) || flag.default !== false) {
            errors.push(`${label} is deferred, so ${rawCapability.featureFlag} must default to false`);
          }
        }
      } else if (rawCapability.status === "deferred") {
        errors.push(`${label} is deferred and must reference a default-off feature flag`);
      }

      if (typeof rawCapability.studioConsumer === "string") {
        for (const forbidden of FORBIDDEN_STUDIO_CONSUMERS) {
          if (forbidden.pattern.test(rawCapability.studioConsumer)) {
            errors.push(`${label}.studioConsumer contains ${forbidden.label}`);
          }
        }
      }
    });
  }

  for (const id of REQUIRED_CAPABILITY_IDS) {
    if (!seenIds.has(id)) errors.push(`required capability is missing: ${id}`);
  }
}

if (errors.length > 0) {
  console.error(`Runtime product parity verification failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const capabilityCount = isRecord(document) && Array.isArray(document.capabilities) ? document.capabilities.length : 0;
const flagCount = isRecord(document) && isRecord(document.featureFlags) ? Object.keys(document.featureFlags).length : 0;
console.log(`Runtime product parity verification passed: ${capabilityCount} capabilities, ${flagCount} default-off feature flags.`);
