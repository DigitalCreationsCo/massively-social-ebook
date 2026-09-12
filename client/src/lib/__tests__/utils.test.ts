import { describe, expect, it, vi } from "vitest";

import { generateClientUuid } from "../utils";

describe("generateClientUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("known-uuid");

    expect(generateClientUuid()).toBe("known-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates an RFC 4122 v4 UUID when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    });

    expect(generateClientUuid()).toBe("00000000-0000-4000-8000-000000000000");

    vi.unstubAllGlobals();
  });
});
