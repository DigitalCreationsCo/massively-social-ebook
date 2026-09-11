import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import {
  fetchReferenceImages,
  getImageReferenceLimits,
  isAllowedImageUrl,
  isValidNestedRepresentation,
  resolveAllowedHosts,
  selectImageRepresentations,
  __setPresignFunctionForTests,
  __testables,
  loadPresignFunction,
  resolvePresignOptions,
  type SelectedImageRepresentation,
} from "./image-references";
import { logger } from "../logger";
import { presignRepresentation } from "@portalshq/px";

vi.mock("@portalshq/px", () => ({ presignRepresentation: vi.fn() }));

function signedResult(url = "https://storage.googleapis.com/bucket/portrait.png?token=x") {
  return { url, expires_at: 999, revision: "r", repository_id: "repo",
    address: "addr", representation: "portrait", format: "png" };
}

function entity(id: string, representations: Record<string, unknown>, name = id) {
  return { id, name, type: "character", representations };
}

function validRep(hash: string, format = "png", uri = "portrait.png") {
  return { hash, format, uri };
}

function selected(entityId: string, key: string, hash: string, uri?: string): SelectedImageRepresentation {
  return {
    entityId,
    representationKey: key,
    hash,
    format: "png",
    ...(uri ? { uri } : {}),
    property: key,
  };
}

function imageResponse(body: Uint8Array, mime = "image/png") {
  return new Response(body as BodyInit, {
    status: 200,
    headers: { "content-type": mime, "content-length": String(body.length) },
  });
}

describe("selectImageRepresentations", () => {
  it("selects by ordered preference", () => {
    const entities = [
      entity("px://repo/character/hero", {
        a: validRep("hash-a"),
        b: validRep("hash-b"),
      }),
    ];
    const result = selectImageRepresentations(entities, ["b", "a"], 5);
    expect(result).toHaveLength(1);
    expect(result[0]?.representationKey).toBe("b");
    expect(result[0]?.hash).toBe("hash-b");
  });

  it("prefers a character sheet and falls back to the portrait", () => {
    const both = entity("px://repo/character/hero", {
      portrait: validRep("portrait-hash"),
      character_sheet: validRep("sheet-hash"),
    });
    const portraitOnly = entity("px://repo/character/legacy", {
      portrait: validRep("legacy-portrait-hash"),
    });
    const result = selectImageRepresentations(
      [both, portraitOnly],
      ["character_sheet", "portrait"],
      5,
    );

    expect(result.map(({ representationKey, hash }) => ({ representationKey, hash }))).toEqual([
      { representationKey: "character_sheet", hash: "sheet-hash" },
      { representationKey: "portrait", hash: "legacy-portrait-hash" },
    ]);
  });

  it("selects first valid entry when preference list is empty", () => {
    const entities = [
      entity("px://repo/character/hero", {
        first: validRep("hash-1"),
        second: validRep("hash-2"),
      }),
    ];
    const result = selectImageRepresentations(entities, [], 5);
    expect(result).toHaveLength(1);
    expect(result[0]?.representationKey).toBe("first");
  });

  it("selects nothing when preferred properties are missing", () => {
    const entities = [
      entity("px://repo/character/hero", {
        other: validRep("hash-other"),
      }),
    ];
    const result = selectImageRepresentations(entities, ["missing", "also-missing"], 5);
    expect(result).toHaveLength(0);
  });

  it("skips malformed entries", () => {
    const entities = [
      entity("px://repo/character/hero", {
        bad1: { format: "png" },
        bad2: { hash: "hash-x" },
        bad3: "not-an-object",
        bad4: { hash: "", format: "png" },
        bad5: { hash: "  ", format: "png" },
        bad6: { hash: "hash-ok", format: "" },
        good: validRep("hash-good"),
      }),
    ];
    const result = selectImageRepresentations(entities, [], 5);
    expect(result).toHaveLength(1);
    expect(result[0]?.hash).toBe("hash-good");
  });

  it("selects at most one per entity", () => {
    const entities = [
      entity("px://repo/character/a", { x: validRep("h1"), y: validRep("h2") }),
      entity("px://repo/character/b", { x: validRep("h3") }),
    ];
    const result = selectImageRepresentations(entities, [], 5);
    expect(result).toHaveLength(2);
    expect(result.filter((r) => r.entityId === "px://repo/character/a")).toHaveLength(1);
  });

  it("respects maxUniqueEntityRepresentations", () => {
    const entities = [
      entity("px://repo/character/a", { x: validRep("h1") }),
      entity("px://repo/character/b", { x: validRep("h2") }),
      entity("px://repo/character/c", { x: validRep("h3") }),
    ];
    const result = selectImageRepresentations(entities, [], 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.entityId).toBe("px://repo/character/a");
  });

  it("deduplicates by content-addressed hash", () => {
    const entities = [
      entity("px://repo/character/a", { x: validRep("same-hash") }),
      entity("px://repo/character/b", { x: validRep("same-hash") }),
      entity("px://repo/character/c", { x: validRep("other-hash") }),
    ];
    const result = selectImageRepresentations(entities, [], 5);
    expect(result.map((r) => r.hash).sort()).toEqual(["other-hash", "same-hash"]);
    expect(result).toHaveLength(2);
  });

  it("returns empty when max is zero and skips entities without ids or maps", () => {
    expect(selectImageRepresentations([entity("a", { x: validRep("h") })], [], 0)).toEqual([]);
    expect(
      selectImageRepresentations(
        [{ name: "no-id", representations: { x: validRep("h") } }, { id: "has-id" }, { id: "x", representations: null }],
        [],
        5,
      ),
    ).toEqual([]);
  });
});

describe("isValidNestedRepresentation", () => {
  it("requires non-empty hash and format", () => {
    expect(isValidNestedRepresentation({ hash: "h", format: "png" })).toBe(true);
    expect(isValidNestedRepresentation({ hash: "h", format: "png", uri: "https://example.test/a.png" })).toBe(true);
    expect(isValidNestedRepresentation({ hash: "", format: "png" })).toBe(false);
    expect(isValidNestedRepresentation({ hash: "h", format: "" })).toBe(false);
    expect(isValidNestedRepresentation({ hash: "h" })).toBe(false);
    expect(isValidNestedRepresentation("string")).toBe(false);
    expect(isValidNestedRepresentation(null)).toBe(false);
  });
});

describe("getImageReferenceLimits", () => {
  it("caps Gemini 2.5 Flash Image at 3", () => {
    expect(getImageReferenceLimits("google", "gemini-2.5-flash-image").maxImages).toBe(3);
  });
  it("caps Gemini 3 Pro Image at 14", () => {
    expect(getImageReferenceLimits("google", "gemini-3-pro-image-preview").maxImages).toBe(14);
  });
  it("caps OpenAI gpt-image-* at 16", () => {
    expect(getImageReferenceLimits("openai", "gpt-image-1.5").maxImages).toBe(16);
  });
  it("is conservative for unknown models", () => {
    expect(getImageReferenceLimits("unknown", "mystery-model").maxImages).toBe(1);
  });
});

describe("resolveAllowedHosts / isAllowedImageUrl", () => {
  const env = process.env;
  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...env };
  });
  afterEach(() => {
    process.env = env;
  });

  it("uses IMAGE_REFERENCE_ALLOWED_HOSTS exactly when set", () => {
    vi.stubEnv("IMAGE_REFERENCE_ALLOWED_HOSTS", "Example.COM, cdn.example.test");
    expect(resolveAllowedHosts()).toEqual(["example.com", "cdn.example.test"]);
  });

  it("defaults to GCS standard host forms", () => {
    vi.stubEnv("IMAGE_REFERENCE_ALLOWED_HOSTS", "");
    vi.stubEnv("GOOGLE_CLOUD_BUCKET", "my-bucket");
    const hosts = resolveAllowedHosts();
    expect(hosts).toContain("storage.googleapis.com");
    expect(hosts).toContain("my-bucket.storage.googleapis.com");
  });

  it("derives the Lore host from either PX variable", () => {
    vi.stubEnv("IMAGE_REFERENCE_ALLOWED_HOSTS", "");
    vi.stubEnv("PX_LORE_HTTP_URL", "");
    vi.stubEnv("PX_LORE_URL_BASE", "lore://100.105.14.118:41337");
    expect(resolveAllowedHosts()).toContain("100.105.14.118");

    vi.stubEnv("PX_LORE_URL_BASE", "");
    vi.stubEnv("PX_LORE_HTTP_URL", "http://100.105.14.118:41339");
    expect(resolveAllowedHosts()).toContain("100.105.14.118");
  });

  it("allows allowlisted hosts over HTTP and HTTPS", () => {
    const allowed = ["storage.googleapis.com", "100.105.14.118"];
    expect(isAllowedImageUrl(new URL("https://storage.googleapis.com/b/a.png"), allowed)).toBe(true);
    expect(isAllowedImageUrl(new URL("http://storage.googleapis.com/b/a.png"), allowed)).toBe(true);
    expect(isAllowedImageUrl(new URL("http://100.105.14.118:41339/r/a.png"), allowed)).toBe(true);
    expect(isAllowedImageUrl(new URL("https://evil.test/a.png"), allowed)).toBe(false);
    expect(isAllowedImageUrl(new URL("http://evil.test/a.png"), allowed)).toBe(false);
    expect(isAllowedImageUrl(new URL("ftp://storage.googleapis.com/b/a.png"), allowed)).toBe(false);
  });

  it("still blocks loopback in production even when allowlisted", () => {
    vi.stubEnv("NODE_ENV", "production");
    const allowed = ["127.0.0.1", "localhost"];
    expect(isAllowedImageUrl(new URL("http://127.0.0.1:41339/a.png"), allowed)).toBe(false);
    expect(isAllowedImageUrl(new URL("https://localhost/a.png"), allowed)).toBe(false);
  });
});

describe("fetchReferenceImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __testables.sharedReferenceCache.clear();
    __setPresignFunctionForTests(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setPresignFunctionForTests(undefined);
  });

  it("presigns JIT then downloads into buffers", async () => {
    const presignFn = vi.fn(async () => ({
      url: "https://storage.googleapis.com/bucket/a.png?token=x",
      expires_at: 999,
      revision: "r",
      repository_id: "repo",
      address: "addr",
      representation: "reference_image",
      format: "png",
    }));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = vi.fn(async () => imageResponse(bytes));
    const result = await fetchReferenceImages(
      [selected("px://repo/character/hero", "reference_image", "hash-1")],
      { presignFn, fetchFn, allowedHosts: ["storage.googleapis.com"], maxImages: 3 },
    );
    expect(presignFn).toHaveBeenCalledWith("px://repo/character/hero", "reference_image", expect.anything());
    expect(result).toHaveLength(1);
    expect(result[0]?.buffer).toBeInstanceOf(Buffer);
    expect([...result[0]!.buffer]).toEqual([1, 2, 3, 4]);
    expect(result[0]?.mimeType).toBe("image/png");
  });

  it.each(["px://25th-chapter/character/nathan-gunn", "25th-chapter/character/nathan-gunn"])(
    "presigns entity %s and its manifest key through the SDK with filename metadata",
    async (entityId) => {
      vi.mocked(presignRepresentation).mockResolvedValue(signedResult());
      vi.stubEnv("REFERENCE_TOKEN", "test-token");
      const fetchFn = vi.fn(async () => imageResponse(new Uint8Array([9, 9])));
      const references = selectImageRepresentations([
        entity(entityId, { item: validRep("item-hash", "jpg", "item.jpg"),
          portrait: validRep("portrait-hash", "png", "portrait.png") }),
      ], ["portrait"], 1);
      const presignOptions = { repoPath: "/tmp/px", branch: "main", ttlSeconds: 900,
        httpUrl: "https://lore.example.test", tokenEnv: "REFERENCE_TOKEN" };
      const result = await fetchReferenceImages(references, {
        presignOptions, fetchFn, allowedHosts: ["storage.googleapis.com"],
      });
      expect(await loadPresignFunction()).toBe(presignRepresentation);
      expect(presignRepresentation).toHaveBeenCalledWith(entityId, "portrait", {
        repoPath: "/tmp/px", branch: "main", ttlSeconds: 900,
        httpUrl: "https://lore.example.test", bearerToken: "test-token",
      });
      expect(fetchFn).toHaveBeenCalledWith(signedResult().url, expect.anything());
      expect(result).toHaveLength(1);
    },
  );

  it.each(["portrait.png", "https://storage.googleapis.com/bucket/a.png"])(
    "never downloads stored URI %s when presign is unavailable or fails",
    async (uri) => {
      const fetchFn = vi.fn();
      for (const presignFn of [null, vi.fn(async () => { throw new Error("unavailable"); }),
        vi.fn(async () => signedResult(""))]) {
        const result = await fetchReferenceImages([
          selected("px://repo/character/hero", "portrait", "hash-uri", uri),
        ], { presignFn, fetchFn, allowedHosts: ["storage.googleapis.com"] });
        expect(result).toEqual([]);
      }
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ commit: "pinned" }, "main", "old", { commit: "pinned" }],
    [{ branch: "feature" }, "main", "old", { branch: "feature" }],
  ])("explicit revision overrides environment defaults", (overrides, branch, commit, expected) => {
    vi.stubEnv("PX_BRANCH", branch);
    vi.stubEnv("PX_COMMIT", commit);
    const resolved = resolvePresignOptions(overrides);
    expect({ branch: resolved.branch, commit: resolved.commit }).toEqual(expected);
  });

  it("logs a safe authentication failure category", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      await fetchReferenceImages([selected("repo/character/hero", "portrait", "auth-hash")], {
        presignFn: async () => { throw new Error("unauthenticated https://example.test/?token=private-token"); },
      });
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).toContain("presign_auth_failed");
      expect(logged).not.toContain("private-token");
      expect(logged).not.toContain("example.test");
    } finally { info.mockRestore(); }
  });

  it("rejects conflicting revisions before requesting a URL", async () => {
    const presignFn = vi.fn(async () => signedResult());
    const result = await fetchReferenceImages([
      selected("px://repo/character/hero", "portrait", "hash-revision", "portrait.png"),
    ], { presignFn, presignOptions: { branch: "main", commit: "abc123" } });
    expect(result).toEqual([]);
    expect(presignFn).not.toHaveBeenCalled();
  });

  it("uses the documented Lore token environment variables", () => {
    vi.stubEnv("PX_TOKEN_ENV", "");
    vi.stubEnv("PX_LORE_HTTP_TOKEN", "http-token");
    vi.stubEnv("PX_LORE_GRPC_TOKEN", "grpc-token");
    expect(resolvePresignOptions().bearerToken).toBe("http-token");
    vi.stubEnv("PX_LORE_HTTP_TOKEN", "");
    expect(resolvePresignOptions().bearerToken).toBe("grpc-token");
    expect(resolvePresignOptions({ bearerToken: "explicit" }).bearerToken).toBe("explicit");
  });

  it("backfills provider capacity after failed downloads", async () => {
    const presignFn = vi.fn(async (_uri: string, rep: string) => ({
      url: `https://storage.googleapis.com/bucket/${rep}.png`,
      expires_at: 1,
      revision: "r",
      repository_id: "repo",
      address: "a",
      representation: rep,
      format: "png",
    }));
    const good = new Uint8Array([7]);
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("bad")) throw new Error("network down");
      return imageResponse(good);
    });
    const result = await fetchReferenceImages(
      [
        selected("px://r/character/a", "bad1", "h-bad1"),
        selected("px://r/character/b", "good1", "h-good1"),
        selected("px://r/character/c", "good2", "h-good2"),
      ],
      { presignFn, fetchFn, allowedHosts: ["storage.googleapis.com"], maxImages: 2 },
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.hash).sort()).toEqual(["h-good1", "h-good2"]);
  });

  it("rejects disallowed hosts, bad redirects, MIME, and oversize bodies", async () => {
    const presignFn = vi.fn(async (uri: string) => ({
      url: uri.includes("evil-host") ? "https://evil.test/a.png"
        : uri.includes("redirect") ? "https://storage.googleapis.com/bucket/r.png"
        : uri.includes("mime") ? "https://storage.googleapis.com/bucket/m.png"
        : "https://storage.googleapis.com/bucket/big.png",
      expires_at: 1,
      revision: "r",
      repository_id: "repo",
      address: "a",
      representation: "k",
      format: "png",
    }));
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/r.png")) {
        return new Response(null, { status: 302, headers: { location: "https://evil.test/loot.png" } });
      }
      if (u.includes("/m.png")) return imageResponse(new Uint8Array([1]), "text/html");
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(100 * 1024 * 1024) },
      });
    });
    const result = await fetchReferenceImages(
      [
        selected("px://evil-host/character/a", "k", "h1"),
        selected("px://redirect/character/a", "k", "h2"),
        selected("px://mime/character/a", "k", "h3"),
        selected("px://big/character/a", "k", "h4"),
      ],
      {
        presignFn,
        fetchFn,
        allowedHosts: ["storage.googleapis.com"],
        maxImages: 4,
        maxBytesPerImage: 10,
        allowedMimeTypes: ["image/png"],
      },
    );
    expect(result).toEqual([]);
  });

  it("downloads http presigned URLs on allowlisted hosts (dev Lore)", async () => {
    const presignFn = vi.fn(async () => signedResult("http://100.105.14.118:41339/r/image.png?token=x"));
    const fetchFn = vi.fn(async () => imageResponse(new Uint8Array([1, 2, 3])));
    const result = await fetchReferenceImages(
      [selected("px://25th-chapter/character/claire-cole", "character_sheet", "blake3:abc")],
      { presignFn, fetchFn, allowedHosts: ["100.105.14.118"], maxImages: 3 },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.mimeType).toBe("image/png");
  });

  it("follows redirects across allowlisted http/https hosts", async () => {
    const presignFn = vi.fn(async () => signedResult("http://100.105.14.118:41339/r/image.png?token=x"));
    const fetchFn = vi.fn(async (url: unknown) => {
      if (String(url).startsWith("http://100.105.14.118")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://storage.googleapis.com/bucket/image.png?token=y" },
        });
      }
      return imageResponse(new Uint8Array([4, 5]));
    });
    const result = await fetchReferenceImages(
      [selected("px://25th-chapter/character/claire-cole", "character_sheet", "blake3:abc")],
      { presignFn, fetchFn, allowedHosts: ["100.105.14.118", "storage.googleapis.com"], maxImages: 3 },
    );
    expect(result).toHaveLength(1);
    expect([...result[0]!.buffer]).toEqual([4, 5]);
  });

  it("accepts valid images missing a Content-Type via magic bytes", async () => {
    const presignFn = vi.fn(async () => signedResult("http://100.105.14.118:41339/r/image.png?token=x"));
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fetchFn = vi.fn(async () => new Response(pngBytes as BodyInit, { status: 200 }));
    const result = await fetchReferenceImages(
      [selected("px://25th-chapter/character/claire-cole", "character_sheet", "blake3:abc")],
      { presignFn, fetchFn, allowedHosts: ["100.105.14.118"] },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.mimeType).toBe("image/png");
  });

  it("accepts valid images served as application/octet-stream via magic bytes", async () => {
    const presignFn = vi.fn(async () => signedResult());
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const fetchFn = vi.fn(async () => imageResponse(jpegBytes, "application/octet-stream"));
    const result = await fetchReferenceImages(
      [selected("px://r/character/a", "k", "h-octet")],
      { presignFn, fetchFn, allowedHosts: ["storage.googleapis.com"] },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.mimeType).toBe("image/jpeg");
  });

  it("still rejects non-image bytes without a usable Content-Type", async () => {
    const presignFn = vi.fn(async () => signedResult());
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]) as BodyInit, { status: 200 }));
    const result = await fetchReferenceImages(
      [selected("px://r/character/a", "k", "h-garbage")],
      { presignFn, fetchFn, allowedHosts: ["storage.googleapis.com"] },
    );
    expect(result).toEqual([]);
  });

  it("propagates parent abort instead of skipping", async () => {
    const controller = new AbortController();
    controller.abort(new Error("broadcast stopped"));
    const fetchFn = vi.fn(async () => imageResponse(new Uint8Array([1])));
    await expect(
      fetchReferenceImages([selected("px://r/character/a", "k", "h1", "https://storage.googleapis.com/b/a.png")], {
        presignFn: null,
        fetchFn,
        allowedHosts: ["storage.googleapis.com"],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("degrades to empty when every reference fails", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("down");
    });
    const result = await fetchReferenceImages(
      [selected("px://r/character/a", "k", "h1", "https://storage.googleapis.com/b/a.png")],
      { presignFn: null, fetchFn, allowedHosts: ["storage.googleapis.com"] },
    );
    expect(result).toEqual([]);
  });

  it("logs hashes/counts/pairs without URIs or bytes", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      const presignFn = vi.fn(async () => ({
        url: "https://storage.googleapis.com/bucket/secret.png?token=super-secret",
        expires_at: 1,
        revision: "r",
        repository_id: "repo",
        address: "a",
        representation: "k",
        format: "png",
      }));
      const fetchFn = vi.fn(async () => imageResponse(new Uint8Array([5, 6])));
      await fetchReferenceImages([selected("px://r/character/hero", "k", "hash-log-1")], {
        presignFn,
        fetchFn,
        allowedHosts: ["storage.googleapis.com"],
      });
      expect(info).toHaveBeenCalled();
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).toContain("hash-log-1");
      expect(logged).toContain("px://r/character/hero#k");
      expect(logged).not.toContain("super-secret");
      expect(logged).not.toContain("secret.png");
    } finally {
      info.mockRestore();
    }
  });

  it("streams with a hard byte cap instead of blind arrayBuffer", async () => {
    const big = new Uint8Array(100).fill(7);
    const fetchFn = vi.fn(async () => imageResponse(big));
    const result = await fetchReferenceImages(
      [selected("px://r/character/a", "k", "h-cap", "https://storage.googleapis.com/b/a.png")],
      { presignFn: async () => signedResult(), fetchFn, allowedHosts: ["storage.googleapis.com"], maxBytesPerImage: 10 },
    );
    expect(result).toEqual([]);
    expect(fetchFn).toHaveBeenCalled();
  });
});

describe("validateServerConfiguration", () => {
  const { validateServerConfiguration } = __testables;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PX_LORE_URL_BASE;
    delete process.env.PX_LORE_HTTP_URL;
    delete process.env.PX_REPO_PATH;
    delete process.env.PX_DIR;
  });

  it("warns when no server configuration is found", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      validateServerConfiguration();
      expect(warn).toHaveBeenCalledWith(
        "[ImageRefs] No PX server configuration found. Set PX_LORE_URL_BASE or PX_LORE_HTTP_URL.",
        "broadcast",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when both local repo and remote server are configured", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      process.env.PX_LORE_HTTP_URL = "http://remote.example.com:41339";
      process.env.PX_REPO_PATH = "/tmp/px";
      validateServerConfiguration();
      expect(warn).toHaveBeenCalledWith(
        "[ImageRefs] Both PX_REPO_PATH and remote Lore URL are configured. CLI may prefer local repository, potentially causing hash mismatches with SDK operations.",
        "broadcast",
        expect.objectContaining({
          repoPath: "/tmp/px",
          loreUrlBase: "http://remote.example.com:41339",
        }),
      );
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("logs when using Lore URL base", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      process.env.PX_LORE_URL_BASE = "lore://100.105.14.118:41337";
      validateServerConfiguration();
      expect(info).toHaveBeenCalledWith(
        "[ImageRefs] PX server configuration: using Lore URL base",
        "broadcast",
        { loreUrlBase: "lore://100.105.14.118:41337" },
      );
    } finally {
      info.mockRestore();
    }
  });

  it("logs when using Lore HTTP URL", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      process.env.PX_LORE_HTTP_URL = "http://remote.example.com:41339";
      validateServerConfiguration();
      expect(info).toHaveBeenCalledWith(
        "[ImageRefs] PX server configuration: using Lore HTTP URL",
        "broadcast",
        { httpUrl: "http://remote.example.com:41339" },
      );
    } finally {
      info.mockRestore();
    }
  });

  it("logs when using local repository", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      process.env.PX_REPO_PATH = "/tmp/px";
      validateServerConfiguration();
      expect(info).toHaveBeenCalledWith(
        "[ImageRefs] PX server configuration: using local repository",
        "broadcast",
        { repoPath: "/tmp/px" },
      );
    } finally {
      info.mockRestore();
    }
  });
});
