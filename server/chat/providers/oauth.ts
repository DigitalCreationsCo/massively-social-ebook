import { requireSecret } from "../../broadcast/config";

export interface OAuthSecretRefs {
  clientIdEnv: string;
  clientSecretEnv: string;
  refreshTokenEnv: string;
}

export async function refreshAccessToken(
  tokenUrl: string,
  refs: OAuthSecretRefs,
  extra: Record<string, string> = {},
): Promise<{ accessToken: string; expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: requireSecret(refs.refreshTokenEnv, "provider refresh token"),
    client_id: requireSecret(refs.clientIdEnv, "provider client id"),
    client_secret: requireSecret(refs.clientSecretEnv, "provider client secret"),
    ...extra,
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`OAuth refresh failed (${response.status})`);
  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("OAuth refresh returned no access token");
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max(30, token.expires_in ?? 3_600) * 1_000,
  };
}

export function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(done, delayMs);
    timer.unref?.();
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}
