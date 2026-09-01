import { describe, expect, it } from "vitest";

import { parseYoutubeJsonStream } from "./youtube";

function chunked(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("YouTube live chat streaming parser", () => {
  it("parses adjacent JSON objects split across arbitrary network chunks", async () => {
    const stream = chunked(
      '{"items":[{"id":"one","snippet":{"displayMessage":"hello } world"}}',
      ']} {"items":[{"id":"two"}]}',
    );

    const payloads = [];
    for await (const payload of parseYoutubeJsonStream(stream)) payloads.push(payload);

    expect(payloads.map((payload) => payload.items?.[0]?.id)).toEqual(["one", "two"]);
  });
});
