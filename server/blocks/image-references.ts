/**
 * Canonical image reference handling for story image generation.
 *
 * - Selection is exclusively from nested `entity.representations` maps.
 * - Downloads are just-in-time: presign (entity NAP URI, representation key)
 *   via the NAP SDK, then fetch the temporary HTTP URL
 *   server-side into a bounded Buffer for AI SDK `generateImage`.
 * - Never forwards signed URLs to the image provider and never logs them.
 */

import type { PresignOptions as SdkPresignOptions, presignRepresentation } from "@portalshq/nap-sdk";
export type { PresignedRepresentation } from "@portalshq/nap-sdk";

import { logger } from "../logger";
import { presignFailureReason, presignWithCli } from "./nap-presign";

// ── Types ──────────────────────────────────────────────────────────────────

/** Typed nested representation value stored on `entity.representations[key]`. */
export interface NestedRepresentationValue {
  hash: string;
  format: string;
  /** Filename relative to the entity asset directory; never a download URL. */
  uri?: string;
  description?: string;
  name?: string;
  tier?: string;
  [key: string]: unknown;
}

/**
 * One preference-selected representation from an entity's nested map.
 * `entityId` is the entity's NAP URI (`nap://…`) and `representationKey`
 * is the nested map key used for just-in-time presigning.
 */
export interface SelectedImageRepresentation {
  entityId: string;
  representationKey: string;
  hash: string;
  format: string;
  /** Filename relative to the entity asset directory; never a download URL. */
  uri?: string;
  description?: string;
  entityName?: string;
  name?: string;
  /** Alias for representationKey, retained for observability. */
  property?: string;
}

/** Minimal entity shape needed for selection (compatible with old + new engine types). */
interface SelectableEntity {
  id?: unknown;
  name?: unknown;
  representations?: unknown;
}

export interface PresignOptions extends SdkPresignOptions {
  /** Env var name holding the bearer token (CLI `--token-env` parity). */
  tokenEnv?: string;
}

export type PresignFunction = typeof presignRepresentation;

export interface FetchedReferenceImage {
  buffer: Buffer;
  mimeType: string;
  hash: string;
  entityId: string;
  representationKey: string;
}

export interface FetchReferenceImagesOptions {
  signal?: AbortSignal;
  allowedHosts?: string[];
  maxImages?: number;
  maxBytesPerImage?: number;
  allowedMimeTypes?: string[];
  timeoutMs?: number;
  presignOptions?: PresignOptions;
  presignFn?: PresignFunction | null;
  fetchFn?: typeof fetch;
  cache?: Map<string, { buffer: Buffer; mimeType: string }>;
}

export interface ReferenceSkip {
  entityId: string;
  representationKey: string;
  hash?: string;
  reason: string;
}

// ── Selection ──────────────────────────────────────────────────────────────

const SUPPORTED_IMAGE_FORMATS = new Set(["png", "jpg", "jpeg", "webp"]);

function normalizeFormat(format: string): string {
  const trimmed = format.trim().toLowerCase();
  if (trimmed.startsWith("image/")) return trimmed.slice("image/".length);
  if (trimmed.startsWith(".")) return trimmed.slice(1);
  return trimmed;
}

/** Image formats we consider eligible at download time (MIME derived). */
export function isSupportedImageFormat(format: string): boolean {
  return SUPPORTED_IMAGE_FORMATS.has(normalizeFormat(format));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation for a nested representation value.
 * Requires non-empty `hash` and `format`; `uri` is optional because the
 * presign flow derives the download URL just-in-time.
 */
export function isValidNestedRepresentation(value: unknown): value is NestedRepresentationValue {
  if (!isRecord(value)) return false;
  const hash = value["hash"];
  const format = value["format"];
  if (typeof hash !== "string" || hash.trim().length === 0) return false;
  if (typeof format !== "string" || format.trim().length === 0) return false;
  const uri = value["uri"];
  if (uri !== undefined && typeof uri !== "string") return false;
  return true;
}

/**
 * Select at most one representation per entity.
 *
 * - When `representationProperties` is non-empty, iterate it in order and pick
 *   the first valid nested entry. Entities missing every preferred property
 *   contribute nothing.
 * - When empty, pick the first valid nested map entry in insertion order.
 * - Deduplicate by content-addressed hash (first occurrence wins).
 * - Never consult deprecated top-level `context.representations`.
 */
export function selectImageRepresentations(
  entities: readonly unknown[],
  representationProperties: readonly string[],
  maxUniqueEntityRepresentations: number,
): SelectedImageRepresentation[] {
  if (!Number.isInteger(maxUniqueEntityRepresentations) || maxUniqueEntityRepresentations <= 0) {
    return [];
  }
  const preferences = representationProperties.filter((p) => typeof p === "string" && p.length > 0);
  const seenHashes = new Set<string>();
  const selected: SelectedImageRepresentation[] = [];

  for (const entity of entities) {
    if (selected.length >= maxUniqueEntityRepresentations) break;
    if (!isRecord(entity)) continue;
    const rawId = (entity as SelectableEntity).id;
    if (typeof rawId !== "string" || rawId.trim().length === 0) continue;
    const entityId = rawId.trim();
    const rawMap = (entity as SelectableEntity).representations;
    if (!isRecord(rawMap)) continue;
    const rawName = (entity as SelectableEntity).name;
    const entityName = typeof rawName === "string" ? rawName : undefined;

    let match: { key: string; value: NestedRepresentationValue } | undefined;

    if (preferences.length === 0) {
      for (const [key, value] of Object.entries(rawMap)) {
        if (isValidNestedRepresentation(value)) {
          match = { key, value };
          break;
        }
      }
    } else {
      for (const property of preferences) {
        const candidate = (rawMap as Record<string, unknown>)[property];
        if (isValidNestedRepresentation(candidate)) {
          match = { key: property, value: candidate };
          break;
        }
      }
    }

    if (!match) continue;
    const hash = match.value.hash.trim();
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    selected.push({
      entityId,
      representationKey: match.key,
      hash,
      format: match.value.format.trim(),
      ...(typeof match.value.uri === "string" && match.value.uri.length > 0 ? { uri: match.value.uri } : {}),
      ...(typeof match.value.description === "string" ? { description: match.value.description } : {}),
      ...(entityName ? { entityName } : {}),
      ...(typeof match.value.name === "string" ? { name: match.value.name } : {}),
      property: match.key,
    });
  }

  return selected;
}

// ── Provider / model limits ────────────────────────────────────────────────

export interface ImageReferenceLimits {
  maxImages: number;
  maxBytesPerImage: number;
  allowedMimeTypes: string[];
}

const GEMINI_MIMES = ["image/png", "image/jpeg", "image/webp"];
const OPENAI_MIMES = ["image/png", "image/jpeg", "image/webp"];
const DEFAULT_MIMES = ["image/png", "image/jpeg", "image/webp"];

const GEMINI_MAX_BYTES = 7 * 1024 * 1024;
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Active image-model input limits.
 * - Gemini 2.5 Flash Image: up to 3 references.
 * - Gemini 3 Pro Image: up to 14 references.
 * - OpenAI gpt-image-*: up to 16 references.
 * - Unknown models conservatively receive one.
 */
export function getImageReferenceLimits(provider: string, model: string): ImageReferenceLimits {
  const normalizedModel = (model || "").trim().toLowerCase();
  const normalizedProvider = (provider || "").trim().toLowerCase();

  if (normalizedModel.includes("gemini-2.5-flash-image")) {
    return { maxImages: 3, maxBytesPerImage: GEMINI_MAX_BYTES, allowedMimeTypes: GEMINI_MIMES };
  }
  if (normalizedModel.includes("gemini-3-pro-image")) {
    return { maxImages: 14, maxBytesPerImage: GEMINI_MAX_BYTES, allowedMimeTypes: GEMINI_MIMES };
  }
  if (normalizedModel.startsWith("gpt-image") || normalizedModel.includes("gpt-image")) {
    return { maxImages: 16, maxBytesPerImage: OPENAI_MAX_BYTES, allowedMimeTypes: OPENAI_MIMES };
  }
  if (normalizedProvider === "openai") {
    return { maxImages: 16, maxBytesPerImage: OPENAI_MAX_BYTES, allowedMimeTypes: OPENAI_MIMES };
  }
  if (normalizedProvider === "google" && normalizedModel.includes("image")) {
    return { maxImages: 3, maxBytesPerImage: GEMINI_MAX_BYTES, allowedMimeTypes: GEMINI_MIMES };
  }
  return { maxImages: 1, maxBytesPerImage: GEMINI_MAX_BYTES, allowedMimeTypes: DEFAULT_MIMES };
}

// ── Allowed hosts ──────────────────────────────────────────────────────────

function parseHostList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

function hostFromUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Hosts for the NAP Lore server derived from configuration (DRY single source).
 *
 * Both variables describe the same server: `NAP_LORE_HTTP_URL` is the explicit
 * HTTP(S) origin used for presigned URLs, `NAP_LORE_URL_BASE` is the `lore://`
 * base. Either one is enough to allowlist the host presigning will return.
 */
function loreHosts(): string[] {
  const hosts: string[] = [];
  for (const raw of [process.env["NAP_LORE_HTTP_URL"], process.env["NAP_LORE_URL_BASE"]]) {
    const host = hostFromUrl(raw);
    if (host) hosts.push(host);
  }
  return [...new Set(hosts)];
}

/**
 * Resolve the allowlist for reference downloads.
 *
 * - When `IMAGE_REFERENCE_ALLOWED_HOSTS` is set (comma-separated), use exactly
 *   those hosts (simple, explicit, low-risk). Include BOTH storage and Lore
 *   hosts there because the explicit list replaces the defaults below.
 * - Otherwise default to the configured GCS bucket's standard host forms plus
 *   the configured NAP Lore host(s) and loopback for local development/tests.
 */
export function resolveAllowedHosts(): string[] {
  const configured = parseHostList(process.env["IMAGE_REFERENCE_ALLOWED_HOSTS"]);
  if (configured.length > 0) return [...new Set(configured)];

  const hosts = new Set<string>();
  const bucket = process.env["GOOGLE_CLOUD_BUCKET"]?.trim();
  if (bucket) {
    hosts.add("storage.googleapis.com");
    hosts.add(`${bucket.toLowerCase()}.storage.googleapis.com`);
    hosts.add("storage.cloud.google.com");
  } else {
    hosts.add("storage.googleapis.com");
    hosts.add("storage.cloud.google.com");
  }

  for (const loreHost of loreHosts()) hosts.add(loreHost);

  // Loopback for local Lore and unit tests only.
  if (process.env["NODE_ENV"] !== "production") {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("::1");
  }

  return [...hosts];
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Allowlisted hosts may serve over HTTP or HTTPS.
 *
 * Production serves storage and Lore behind TLS so presigned URLs are HTTPS;
 * development Lore is plain HTTP (e.g. `http://100.105.14.118:41339`). Trust is
 * carried by the allowlist itself: an allowlisted host is fetchable over either
 * scheme. Note presigned URLs are bearer capabilities — only allowlist HTTP
 * origins on trusted networks.
 * Loopback must never be reachable from a production server, even when
 * explicitly listed in IMAGE_REFERENCE_ALLOWED_HOSTS.
 */
export function isAllowedImageUrl(url: URL, allowedHosts: readonly string[]): boolean {
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  // Loopback must never be reachable from a production server, even when
  // explicitly listed in IMAGE_REFERENCE_ALLOWED_HOSTS.
  if (isLoopback(hostname) && process.env["NODE_ENV"] === "production") return false;
  if (protocol !== "https:" && protocol !== "http:") return false;
  const normalized = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return normalized.has(hostname);
}

// ── Presign ────────────────────────────────────────────────────────────────

let cachedPresignFn: PresignFunction | null | undefined;

function resolveBearerToken(explicit: PresignOptions = {}): string | undefined {
  if (explicit.bearerToken?.trim()) return explicit.bearerToken.trim();
  const tokenEnvName = explicit.tokenEnv?.trim() || process.env["NAP_TOKEN_ENV"]?.trim();
  if (tokenEnvName) {
    const fromNamed = process.env[tokenEnvName]?.trim();
    if (fromNamed) return fromNamed;
  }
  const direct = process.env["NAP_LORE_HTTP_TOKEN"]?.trim()
    || process.env["NAP_LORE_GRPC_TOKEN"]?.trim();
  if (direct) return direct;
  return undefined;
}

export function resolvePresignOptions(overrides: PresignOptions = {}): PresignOptions {
  const repoPath = overrides.repoPath ?? process.env["NAP_REPO_PATH"]?.trim() ?? process.env["NAP_DIR"]?.trim() ?? undefined;
  const hasExplicitRevision = overrides.branch !== undefined || overrides.commit !== undefined;
  const branch = hasExplicitRevision ? overrides.branch : undefined;
  const commit = hasExplicitRevision ? overrides.commit : undefined;
  const ttlRaw = overrides.ttlSeconds;
  const ttlSeconds = typeof ttlRaw === "number" && Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.floor(ttlRaw) : undefined;
  const httpUrl = overrides.httpUrl ?? process.env["NAP_LORE_HTTP_URL"]?.trim() ?? undefined;
  const bearerToken = resolveBearerToken(overrides);
  const tokenEnv = overrides.tokenEnv ?? undefined;
  return {
    ...(repoPath ? { repoPath } : {}),
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
    ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
    ...(httpUrl ? { httpUrl } : {}),
    ...(bearerToken ? { bearerToken } : {}),
    ...(tokenEnv ? { tokenEnv } : {}),
  };
}

/**
 * Validate that SDK and CLI are configured to use the same Lore server.
 * Logs warnings if configuration inconsistencies are detected that could lead
 * to hash mismatches between SDK and CLI operations.
 */
export function validateServerConfiguration(): void {
  const loreUrlBase = process.env["NAP_LORE_URL_BASE"]?.trim() ?? undefined;
  const sdkHttpUrl = process.env["NAP_LORE_HTTP_URL"]?.trim() ?? undefined;
  const repoPath = process.env["NAP_REPO_PATH"]?.trim() ?? process.env["NAP_DIR"]?.trim() ?? undefined;

  // If no server URL is configured, we can't validate
  if (!loreUrlBase && !sdkHttpUrl && !repoPath) {
    logger.warn("[ImageRefs] No NAP server configuration found. Set NAP_LORE_URL_BASE or NAP_LORE_HTTP_URL.", "broadcast");
    return;
  }

  // If both local repo and remote server are configured, CLI may prefer local
  if (repoPath && (loreUrlBase || sdkHttpUrl)) {
    logger.warn("[ImageRefs] Both NAP_REPO_PATH and remote Lore URL are configured. CLI may prefer local repository, potentially causing hash mismatches with SDK operations.", "broadcast", {
      repoPath,
      loreUrlBase: loreUrlBase ?? sdkHttpUrl,
    });
  }

  // Log the effective configuration for debugging
  if (loreUrlBase) {
    logger.info("[ImageRefs] NAP server configuration: using Lore URL base", "broadcast", { loreUrlBase });
  } else if (sdkHttpUrl) {
    logger.info("[ImageRefs] NAP server configuration: using Lore HTTP URL", "broadcast", { httpUrl: sdkHttpUrl });
  } else if (repoPath) {
    logger.info("[ImageRefs] NAP server configuration: using local repository", "broadcast", { repoPath });
  }
}

/** Load the SDK entry point, which resolves the entity manifest and representation. */
export async function loadPresignFunction(): Promise<PresignFunction | null> {
  if (cachedPresignFn !== undefined) return cachedPresignFn;
  try {
    const sdk = await import("@portalshq/nap-sdk");
    if (typeof sdk.presignRepresentation !== "function") throw new Error("Missing presign export");
    cachedPresignFn = sdk.presignRepresentation;
  } catch {
    logger.warn("[ImageRefs] SDK unavailable; using nap CLI for presigning", "broadcast", {
      reason: "presign_sdk_unavailable",
    });
    cachedPresignFn = presignWithCli;
  }
  return cachedPresignFn;
}

/** Test hook: override the cached presign lookup. */
export function __setPresignFunctionForTests(fn: PresignFunction | null | undefined): void {
  cachedPresignFn = fn;
}

async function presignUrl(
  selected: SelectedImageRepresentation,
  presignOptions: PresignOptions,
  presignFn: PresignFunction | null | undefined,
): Promise<string> {
  if (!presignFn) throw Object.assign(new Error("NAP presign unavailable"), { code: "sdk_unavailable" });
  const resolved = resolvePresignOptions(presignOptions);
  const { tokenEnv: _tokenEnv, ...sdkOptions } = resolved;
  if (sdkOptions.branch && sdkOptions.commit) {
    throw Object.assign(new Error("NAP presign accepts either branch or commit, not both"), { code: "invalid_revision" });
  }
  // NAP resolves the manifest at the selected revision using this entity ID,
  // then looks up the exact map key. The representation URI is only a filename.
  const presigned = await presignFn(selected.entityId, selected.representationKey, sdkOptions);
  if (presigned && typeof presigned.url === "string" && presigned.url.trim().length > 0) {
    return presigned.url;
  }
  throw Object.assign(new Error("presign returned an empty URL"), { code: "invalid_response" });
}

// ── Download ───────────────────────────────────────────────────────────────

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

const sharedReferenceCache = new Map<string, { buffer: Buffer; mimeType: string }>();
const MAX_SHARED_CACHE_ENTRIES = 50;

function getCache(cache?: Map<string, { buffer: Buffer; mimeType: string }>): Map<string, { buffer: Buffer; mimeType: string }> {
  return cache ?? sharedReferenceCache;
}

function normalizeMime(contentType: string | null): string {
  if (!contentType) return "";
  return contentType.split(";")[0]!.trim().toLowerCase();
}

function combineSignals(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const timeoutSignal = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
    ? (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(timeoutMs)
    : undefined;
  const signals: AbortSignal[] = [];
  if (parent) signals.push(parent);
  if (timeoutSignal) signals.push(timeoutSignal);
  if (signals.length === 0) {
    const controller = new AbortController();
    return { signal: controller.signal, cleanup: () => undefined };
  }
  if (signals.length === 1) return { signal: signals[0]!, cleanup: () => undefined };
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return { signal: anyFn(signals), cleanup: () => undefined };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signals.find((s) => s.aborted)?.reason);
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of signals) s.removeEventListener("abort", onAbort);
    },
  };
}

async function readBodyWithCap(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const contentLengthRaw = response.headers.get("content-length");
  if (contentLengthRaw !== null) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw Object.assign(new Error(`reference exceeds per-image size limit (${contentLength} > ${maxBytes})`), { code: "too_large" });
    }
  }
  const body = response.body;
  if (!body) throw Object.assign(new Error("reference response has no body"), { code: "empty_body" });

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw Object.assign(new Error(`reference exceeds per-image size limit (${total} > ${maxBytes})`), { code: "too_large" });
        }
        chunks.push(value);
      }
    }
    completed = true;
  } finally {
    if (!completed) {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  if (total === 0) throw Object.assign(new Error("reference response was empty"), { code: "empty_body" });
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(combined);
}

function skipReasonFromError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code) return code;
    const message = error.message.toLowerCase();
    if (message.includes("aborted") || error.name === "AbortError") return "aborted";
    if (message.includes("timeout")) return "timeout";
    return "fetch_failed";
  }
  return "fetch_failed";
}

/**
 * Fetch one reference URL with strict validation. Redirects are followed
 * manually (up to MAX_REDIRECTS) and each hop is validated against the same
 * HTTPS + allowlist policy.
 */
async function downloadOneUrl(
  initialUrl: string,
  allowedHosts: readonly string[],
  allowedMimeTypes: readonly string[],
  maxBytes: number,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const allowedMimes = new Set(allowedMimeTypes.map((m) => m.toLowerCase()));
  let current = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    parentSignal?.throwIfAborted();
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw Object.assign(new Error("reference URL is malformed"), { code: "invalid_url" });
    }
    if (!isAllowedImageUrl(url, allowedHosts)) {
      const protocol = url.protocol.toLowerCase();
      if (protocol !== "https:" && protocol !== "http:") {
        throw Object.assign(new Error("reference URL must use HTTPS"), { code: "invalid_protocol" });
      }
      throw Object.assign(new Error("reference host is not allowlisted"), { code: "host_not_allowed" });
    }

    const { signal, cleanup } = combineSignals(parentSignal, timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(current, { signal, redirect: "manual" });
    } catch (error) {
      cleanup();
      if (parentSignal?.aborted) throw parentSignal.reason;
      throw error;
    }

    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw Object.assign(new Error("redirect without location"), { code: "invalid_redirect" });
        try { await response.arrayBuffer().catch(() => undefined); } catch { /* ignore */ }
        if (hop === MAX_REDIRECTS) throw Object.assign(new Error("too many redirects"), { code: "too_many_redirects" });
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        throw Object.assign(new Error(`reference download failed (${response.status})`), { code: `http_${response.status}` });
      }
      const mimeType = normalizeMime(response.headers.get("content-type"));
      if (!mimeType || !allowedMimes.has(mimeType)) {
        throw Object.assign(new Error(`unsupported reference MIME type (${mimeType || "unknown"})`), { code: "unsupported_mime" });
      }
      const buffer = await readBodyWithCap(response, maxBytes, signal);
      return { buffer, mimeType };
    } finally {
      cleanup();
    }
  }
  throw Object.assign(new Error("too many redirects"), { code: "too_many_redirects" });
}

/**
 * Presign through NAP then download each selected reference into a
 * bounded Buffer. Skips failed/invalid candidates and continues filling the
 * provider's capacity from later candidates. Deduplicates by hash and caches
 * successes in memory. Never logs URLs or bytes.
 */
export async function fetchReferenceImages(
  selected: readonly SelectedImageRepresentation[],
  options: FetchReferenceImagesOptions = {},
): Promise<FetchedReferenceImage[]> {
  const allowedHosts = options.allowedHosts ?? resolveAllowedHosts();
  const maxImages = options.maxImages ?? 3;
  if (maxImages <= 0 || selected.length === 0) return [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? fetch;
  const cache = getCache(options.cache);

  const seenHashes = new Set<string>();
  const ordered: SelectedImageRepresentation[] = [];
  for (const item of selected) {
    if (!item || typeof item.hash !== "string" || item.hash.trim().length === 0) continue;
    const hash = item.hash.trim();
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    ordered.push(item);
  }

  let presignFn = options.presignFn;
  if (presignFn === undefined) {
    try {
      presignFn = await loadPresignFunction();
    } catch {
      presignFn = null;
    }
  }

  const collected: FetchedReferenceImage[] = [];
  const collectedHashes = new Set<string>();
  const skips: ReferenceSkip[] = [];

  // Provider-agnostic MIME/size guard here; callers pass the active model's
  // limits via maxBytesPerImage/allowedMimeTypes when stricter enforcement
  // is needed. Defaults are conservative (Gemini 7 MB, image MIMEs).
  const maxBytes = options.maxBytesPerImage ?? GEMINI_MAX_BYTES;
  const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_MIMES;

  for (const candidate of ordered) {
    if (collected.length >= maxImages) break;
    if (options.signal?.aborted) throw options.signal.reason;
    const hash = candidate.hash.trim();
    if (collectedHashes.has(hash)) continue;

    const cached = cache.get(hash);
    const cachedMimeOk = cached ? allowedMimeTypes.map((m) => m.toLowerCase()).includes(cached.mimeType.toLowerCase()) : false;
    if (cached && cached.buffer.length > 0 && cached.buffer.length <= maxBytes && cachedMimeOk) {
      collected.push({
        buffer: cached.buffer,
        mimeType: cached.mimeType,
        hash,
        entityId: candidate.entityId,
        representationKey: candidate.representationKey,
      });
      collectedHashes.add(hash);
      continue;
    }

    let downloadUrl: string;
    try {
      downloadUrl = await presignUrl(candidate, options.presignOptions ?? {}, presignFn ?? null);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      skips.push({
        entityId: candidate.entityId,
        representationKey: candidate.representationKey,
        hash,
        reason: presignFailureReason(error),
      });
      continue;
    }

    try {
      const { buffer, mimeType } = await downloadOneUrl(
        downloadUrl,
        allowedHosts,
        allowedMimeTypes,
        maxBytes,
        options.signal,
        timeoutMs,
        fetchFn,
      );
      if (cache.size >= MAX_SHARED_CACHE_ENTRIES && cache === sharedReferenceCache) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(hash, { buffer, mimeType });
      collected.push({ buffer, mimeType, hash, entityId: candidate.entityId, representationKey: candidate.representationKey });
      collectedHashes.add(hash);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      const reason = skipReasonFromError(error);
      // Abort/timeout of the parent signal must propagate; per-reference
      // timeouts and validation failures only skip this candidate.
      if (reason === "aborted" && options.signal?.aborted) throw options.signal.reason;
      skips.push({ entityId: candidate.entityId, representationKey: candidate.representationKey, hash, reason });
    }
  }

  logger.info("[ImageRefs] fetch complete", "broadcast", {
    candidates: ordered.length,
    successful: collected.length,
    skipped: skips.length,
    hashes: collected.map((c) => c.hash),
    pairs: collected.map((c) => `${c.entityId}#${c.representationKey}`),
    skipReasons: skips.map((s) => `${s.entityId}#${s.representationKey}:${s.reason}`),
  });

  return collected;
}

export const __testables = {
  normalizeFormat,
  isRecord,
  parseHostList,
  hostFromUrl,
  isLoopback,
  sharedReferenceCache,
  validateServerConfiguration,
};
