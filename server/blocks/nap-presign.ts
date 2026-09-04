import { execFile } from "node:child_process";
import type { PresignOptions, PresignedRepresentation } from "@portalshq/nap-sdk";

/** Only fixed categories are exposed: SDK/CLI errors may contain bearer URLs. */
export function presignFailureReason(error: unknown): string {
  const value = error as { code?: unknown; presignReason?: unknown; message?: unknown; killed?: boolean } | null;
  const safeReasons = ["presign_cli_unavailable", "presign_timeout", "presign_auth_failed",
    "presign_content_not_pushed", "presign_asset_not_found", "presign_endpoint_unconfigured", "presign_hash_mismatch", "presign_failed"];
  if (typeof value?.presignReason === "string" && safeReasons.includes(value.presignReason)) return value.presignReason;
  const code = value?.code;
  if (code === "ENOENT") return "presign_cli_unavailable";
  if (value?.killed || code === "ETIMEDOUT") return "presign_timeout";
  if (code === "invalid_revision") return "presign_invalid_revision";
  if (code === "invalid_response") return "presign_invalid_response";
  if (code === "sdk_unavailable") return "presign_sdk_unavailable";
  const message = typeof value?.message === "string" ? value.message.toLowerCase() : "";
  if (/content hash mismatch|hash mismatch|expected blake3|got blake3/.test(message)) return "presign_hash_mismatch";
  if (/unauthenticated|unauthorized|forbidden|\b401\b|\b403\b|bearer token/.test(message)) return "presign_auth_failed";
  if (/not available in the lore remote|push the pinned revision/.test(message)) return "presign_content_not_pushed";
  if (/not found|no such file|does not exist|no representation|has no repository-relative/.test(message)) return "presign_asset_not_found";
  if (/http origin|http endpoint|ingress/.test(message)) return "presign_endpoint_unconfigured";
  if (/timeout|timed out/.test(message)) return "presign_timeout";
  return "presign_failed";
}

/** Application fallback for SDK packages whose native JS loader cannot load. */
export function presignWithCli(
  entityId: string,
  representation: string,
  options: PresignOptions = {},
): Promise<PresignedRepresentation> {
  const args = ["presign"];
  if (options.repoPath) args.push("--base-dir", options.repoPath);
  if (options.branch) args.push("--branch", options.branch);
  if (options.commit) args.push("--commit", options.commit);
  if (options.ttlSeconds !== undefined) args.push("--ttl-seconds", String(options.ttlSeconds));
  if (options.httpUrl) args.push("--http-url", options.httpUrl);
  const env = { ...process.env };
  if (options.bearerToken) {
    env.NAP_IMAGE_REFERENCE_TOKEN = options.bearerToken;
    args.push("--token-env", "NAP_IMAGE_REFERENCE_TOKEN");
  }
  args.push("--", entityId, representation);
  return new Promise((resolve, reject) => {
    // No shell, no token arguments, bounded output and runtime. Piped stdout is JSON.
    execFile("nap", args, { env, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Classify stderr locally; never attach it (or execFile's command) to errors/logs.
        const reason = presignFailureReason({ code: error.code, killed: error.killed, message: stderr });
        reject(Object.assign(new Error(reason), { presignReason: reason }));
        return;
      }
      try {
        const result: PresignedRepresentation = JSON.parse(stdout);
        if (!result || typeof result.url !== "string" || !result.url.trim()) throw new Error();
        resolve(result);
      } catch {
        reject(Object.assign(new Error("Invalid NAP presign response"), { code: "invalid_response" }));
      }
    });
  });
}
