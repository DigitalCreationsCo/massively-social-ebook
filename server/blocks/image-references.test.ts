import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import {
  fetchReferenceImages,
  getImageReferenceLimits,
  isAllowedImageUrl,
  isValidNestedRepresentation,
  resolveAllowedHosts,
  selectImageRepresentations,
  __setPresignFunctionForTests,
  type SelectedImageRepresentation,
} from "./image-references";
import { logger } from "../logger";

function entity(id: string, representations: Record<string, unknown>, name = id) {
  return { id, name, type: "character", representations };
}

function validRep(hash: string, format = "png", uri = "https://storage.googleapis.com/bucket/a.png") {
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
      entity("nap://repo/character/hero", {
        a: validRep("hash-a"),
        b: validRep("hash-b"),
      }),
    ];
    const result = selectImageRepresentations(entities, ["b", "a"], 5);
    expect(result).toHaveLength(1);
    expect(result[0]?.representationKey).toBe("b");
    expect(result[0]?.hash).toBe("hash-b");
  });

  it("selects first valid entry when preference list is empty", () => {
    const entities = [
      entity("nap://repo/character/hero", {
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
      entity("nap://repo/character/hero", {
        other: validRep("hash-other"),
      }),
    ];
    const result = selectImageRepresentations(entities, ["missing", "also-missing"], 5);
    expect(result).toHaveLength(0);
  });

  it("skips malformed entries", () => {
    const entities = [
      entity("nap://repo/character/hero", {
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
      entity("nap://repo/character/a", { x: validRep("h1"), y: validRep("h2") }),
      entity("nap://repo/character/b", { x: validRep("h3") }),
    ];
    const result = selectImageRepresentations(entities, [], 5);
    expect(result).toHaveLength(2);
    expect(result.filter((r) => r.entityId === "nap://repo/character/a")).toHaveLength(1);
  });

  it("respects maxUniqueEntityRepresentations", () => {
    const entities = [
      entity("nap://repo/character/a", { x: validRep("h1") }),
      entity("nap://repo/character/b", { x: validRep("h2") }),
      entity("nap://repo/character/c", { x: validRep("h3") }),
    ];
    const result = selectImageRepresentations(entities, [], 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.entityId).toBe("nap://repo/character/a");
  });

  it("deduplicates by content-addressed hash", () => {
    const entities = [
      entity("nap://repo/character/a", { x: validRep("same-hash") }),
      entity("nap://repo/character/b", { x: validRep("same-hash") }),
      entity("nap://repo/character/c", { x: validRep("other-hash") }),
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

  it("enforces HTTPS and allowlist", () => {
    const allowed = ["storage.googleapis.com"];
    expect(isAllowedImageUrl(new URL("https://storage.googleapis.com/b/a.png"), allowed)).toBe(true);
    expect(isAllowedImageUrl(new URL("http://storage.googleapis.com/b/a.png"), allowed)).toBe(false);
    expect(isAllowedImageUrl(new URL("https://evil.test/a.png"), allowed)).toBe(false);
  });
});

describe("fetchReferenceImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setPresignFunctionForTests(undefined);
  });
  afterEach(() => {
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
      [selected("nap://repo/character/hero", "reference_image", "hash-1")],
      { presignFn, fetchFn, allowedHosts: ["storage.googleapis.com"], maxImages: 3 },
    );
    expect(presignFn).toHaveBeenCalledWith("nap://repo/character/hero", "reference_image", expect.anything());
    expect(result).toHaveLength(1);
    expect(result[0]?.buffer).toBeInstanceOf(Buffer);
    expect([...result[0]!.buffer]).toEqual([1, 2, 3, 4]);
    expect(result[0]?.mimeType).toBe("image/png");
  });

  it("falls back to stored URI when presign is unavailable (pre-release path)", async () => {
    const bytes = new Uint8Array([9, 9]);
    const fetchFn = vi.fn(async () => imageResponse(bytes));
    const result = await fetchReferenceImages(
      [selected("nap://repo/character/hero", "k", "hash-uri", "https://storage.googleapis.com/bucket/a.png")],
      { presignFn: null, fetchFn, allowedHosts: ["storage.googleapis.com"], maxImages: 3 },
    );
    expect(fetchFn).toHaveBeenCalled();
    expect(result).toHaveLength(1);
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
        selected("nap://r/character/a", "bad1", "h-bad1"),
        selected("nap://r/character/b", "good1", "h-good1"),
        selected("nap://r/character/c", "good2", "h-good2"),
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
        selected("nap://evil-host/character/a", "k", "h1"),
        selected("nap://redirect/character/a", "k", "h2"),
        selected("nap://mime/character/a", "k", "h3"),
        selected("nap://big/character/a", "k", "h4"),
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

  it("propagates parent abort instead of skipping", async () => {
    const controller = new AbortController();
    controller.abort(new Error("broadcast stopped"));
    const fetchFn = vi.fn(async () => imageResponse(new Uint8Array([1])));
    await expect(
      fetchReferenceImages([selected("nap://r/character/a", "k", "h1", "https://storage.googleapis.com/b/a.png")], {
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
      [selected("nap://r/character/a", "k", "h1", "https://storage.googleapis.com/b/a.png")],
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
      await fetchReferenceImages([selected("nap://r/character/hero", "k", "hash-log-1")], {
        presignFn,
        fetchFn,
        allowedHosts: ["storage.googleapis.com"],
      });
      expect(info).toHaveBeenCalled();
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).toContain("hash-log-1");
      expect(logged).toContain("nap://r/character/hero#k");
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
      [selected("nap://r/character/a", "k", "h-cap", "https://storage.googleapis.com/b/a.png")],
      { presignFn: null, fetchFn, allowedHosts: ["storage.googleapis.com"], maxBytesPerImage: 10 },
    );
    expect(result).toEqual([]);
  });
});
