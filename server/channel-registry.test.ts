import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getRequiredEntities,
  getRequiredEntityManifests,
  initializeChannelRegistry,
} from "./channel-registry";

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("channel registry", () => {
  it("refreshes every required manifest atomically before exposing the registry", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "channel-registry-"));
    const filePath = path.join(directory, "channels.json");
    await writeFile(filePath, JSON.stringify({
      channels: {
        main: {
          controlEndpoint: "http://localhost:8000",
          queueTokenEnv: "TEST_QUEUE_TOKEN",
          requiredEntities: ["px://main/character/lead"],
        },
      },
      entities: {},
    }));

    await initializeChannelRegistry({
      filePath,
      resolveManifests: async (uris) => uris.map((id) => ({
        id,
        name: "Lead",
        entity_type: "character",
        type: "character",
        properties: { role: "lead" },
      })),
    });

    expect(getRequiredEntities("main")).toEqual(["px://main/character/lead"]);
    expect(getRequiredEntityManifests("main")).toMatchObject([{ id: "px://main/character/lead", name: "Lead" }]);
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    expect(saved.entities).toHaveProperty("px://main/character/lead");
    expect(saved.entitiesFetchedAt).toEqual(expect.any(String));
  });

  it("does not overwrite the prior file if startup Px resolution fails", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "channel-registry-"));
    const filePath = path.join(directory, "channels.json");
    const original = JSON.stringify({
      channels: { main: { controlEndpoint: "http://localhost:8000", queueTokenEnv: "TEST_QUEUE_TOKEN", requiredEntities: ["px://main/character/lead"] } },
      entities: { "px://main/character/lead": { id: "px://main/character/lead", name: "Old lead", entity_type: "character" } },
    });
    await writeFile(filePath, original);

    await expect(initializeChannelRegistry({ filePath, resolveManifests: async () => { throw new Error("Px unavailable"); } })).rejects.toThrow("Px unavailable");
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  it("reads legacy persisted URI values and rewrites the registry with PX values", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "channel-registry-"));
    const filePath = path.join(directory, "channels.json");
    await writeFile(filePath, JSON.stringify({
      channels: {
        main: {
          controlEndpoint: "http://localhost:8000",
          queueTokenEnv: "TEST_QUEUE_TOKEN",
          requiredEntities: ["nap://main/character/lead"],
        },
      },
      entities: { "nap://main/character/lead": { id: "nap://main/character/lead", name: "Old lead", entity_type: "character" } },
    }));
    const resolveManifests = async (uris: readonly string[]) => uris.map((id) => ({
      id, name: "Lead", entity_type: "character", type: "character",
    }));

    await initializeChannelRegistry({ filePath, resolveManifests });

    expect(getRequiredEntities("main")).toEqual(["px://main/character/lead"]);
    const saved = await readFile(filePath, "utf8");
    expect(saved).toContain("px://main/character/lead");
    expect(saved).not.toContain("nap://");
  });
});
