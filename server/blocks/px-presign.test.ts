import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { presignFailureReason, presignWithCli } from "./px-presign";

vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});
afterEach(() => vi.resetAllMocks());

function complete(error: unknown, stdout = "", stderr = "") {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as Function;
    callback(error, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

describe("PX CLI presign fallback", () => {
  it("forwards IDs, keys, options and token environment without a shell", async () => {
    const response = { url: "https://lore.example.test/content?token=secret", expires_at: 123,
      revision: "abc", repository_id: "repo", address: "hash", representation: "item", format: "jpg" };
    complete(null, JSON.stringify(response));
    await expect(presignWithCli("px://25th-chapter/character/nathan-gunn", "item", {
      repoPath: "/tmp/px path", commit: "abc", ttlSeconds: 900,
      httpUrl: "https://lore.example.test", bearerToken: "private-token",
    })).resolves.toEqual(response);
    expect(execFile).toHaveBeenCalledWith("px", ["presign", "--base-dir", "/tmp/px path",
      "--commit", "abc", "--ttl-seconds", "900", "--http-url", "https://lore.example.test",
      "--token-env", "PX_IMAGE_REFERENCE_TOKEN", "--", "px://25th-chapter/character/nathan-gunn", "item"],
      expect.objectContaining({ timeout: 15000, maxBuffer: 1024 * 1024,
        env: expect.objectContaining({ PX_IMAGE_REFERENCE_TOKEN: "private-token" }) }), expect.any(Function));
    expect(JSON.stringify(vi.mocked(execFile).mock.calls[0]?.[1])).not.toContain("private-token");
  });

  it.each([
    [{ code: "ENOENT" }, "", "presign_cli_unavailable"],
    [{ killed: true }, "", "presign_timeout"],
    [{ code: 1 }, "unauthenticated https://secret.test/?token=private-token", "presign_auth_failed"],
    [{ code: 1 }, "representation content is not available in the Lore remote", "presign_content_not_pushed"],
    [{ code: 1 }, "manifest not found", "presign_asset_not_found"],
    [{ code: 1 }, "content hash mismatch: expected blake3:abc123, got blake3:def456", "presign_hash_mismatch"],
  ])("classifies failures without retaining raw output", async (error, stderr, reason) => {
    complete(error, "", stderr);
    const failure = await presignWithCli("repo/character/hero", "portrait").catch(e => e);
    expect(presignFailureReason(failure)).toBe(reason);
    expect(String(failure)).not.toContain("private-token");
    expect(JSON.stringify(failure)).not.toContain("secret.test");
  });

  it.each(["not JSON secret-token", "null", '{}', '{"url":""}'])("rejects malformed response %s", async (stdout) => {
    complete(null, stdout);
    const error = await presignWithCli("repo/character/hero", "portrait").catch(e => e);
    expect(presignFailureReason(error)).toBe("presign_invalid_response");
    expect(String(error)).not.toContain("secret-token");
  });
});
