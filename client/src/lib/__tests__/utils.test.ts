import { describe, expect, it, vi } from "vitest";

import { generateClientUuid } from "../utils";

describe("generateClientUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("known-uuid");

    expect(generateClientUuid()).toBe("known-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates an RFC 4122 v4 UUID when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    const uuid = generateClientUuid();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    vi.unstubAllGlobals();
  });
});
