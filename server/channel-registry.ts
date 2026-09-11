import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { resolvePxManifests, type ResolvedEntity } from "./blocks/px";
import { isSafeChannelId } from "@shared/channel-id";
import { canonicalizePxUri, isReadablePxUri } from "@shared/px-uri";

const secretReference = z.string().trim().regex(/^[A-Z][A-Z0-9_]*$/, "must name an environment variable");
const pxUri = z.string().refine(isReadablePxUri, "must be a PX URI");

const youtubeConfigSchema = z.object({
  liveChatId: z.string().trim().min(1),
  clientIdEnv: secretReference,
  clientSecretEnv: secretReference,
  refreshTokenEnv: secretReference,
});
const twitchConfigSchema = z.object({
  broadcasterUserId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  clientIdEnv: secretReference,
  clientSecretEnv: secretReference,
  refreshTokenEnv: secretReference,
});
const channelConfigSchema = z.object({
  controlEndpoint: z.string().url().optional(),
  /** @deprecated Use controlEndpoint. Kept for deployment migration only. */
  endpoint: z.string().url().optional(),
  queueTokenEnv: secretReference,
  youtube: youtubeConfigSchema.optional(),
  twitch: twitchConfigSchema.optional(),
  requiredEntities: z.array(pxUri).min(1),
}).superRefine((value, context) => {
  if (!value.controlEndpoint && !value.endpoint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["controlEndpoint"], message: "controlEndpoint is required (the legacy endpoint field is also accepted)" });
  }
});
const channelIdSchema = z.string().trim().refine(isSafeChannelId, {
  message: "must be a URL-path-safe identifier (letters, digits, dots, underscores, and hyphens only)",
});
const cachedManifestSchema = z.object({
  id: pxUri,
  name: z.string().min(1),
  entity_type: z.string().min(1),
}).passthrough();
const registrySchema = z.object({
  channels: z.record(channelIdSchema, channelConfigSchema),
  entities: z.record(pxUri, cachedManifestSchema).default({}),
  /** ISO timestamp of the all-or-nothing Px startup refresh. */
  entitiesFetchedAt: z.string().datetime().optional(),
});

export type ChannelRegistry = z.infer<typeof registrySchema>;
export type RegistryChannelConfig = z.infer<typeof channelConfigSchema>;
export interface ChannelRegistryInitializationOptions {
  filePath?: string;
  resolveManifests?: (uris: readonly string[]) => Promise<ResolvedEntity[]>;
}

let registry: ChannelRegistry | undefined;

/**
 * Persisted channel records may contain a legacy URI, but registry state and
 * all subsequent resolver requests are always canonical PX values.
 */
function canonicalizeRegistry(configured: ChannelRegistry): ChannelRegistry {
  const channels = Object.fromEntries(Object.entries(configured.channels).map(([channelId, channel]) => [
    channelId,
    { ...channel, requiredEntities: channel.requiredEntities.map(canonicalizePxUri) },
  ]));
  const entities = Object.fromEntries(Object.entries(configured.entities).map(([uri, entity]) => {
    const id = canonicalizePxUri(entity.id);
    return [canonicalizePxUri(uri), { ...entity, id }];
  }));
  return { ...configured, channels, entities };
}

export function channelRegistryPath(): string {
  const configured = process.env.CHANNEL_REGISTRY_PATH?.trim();
  if (!configured) {
    throw new Error("CHANNEL_REGISTRY_PATH is required and must point to a writable channel registry JSON file.");
  }
  return path.resolve(configured);
}

export async function initializeChannelRegistry(options: ChannelRegistryInitializationOptions = {}): Promise<void> {
  const filePath = options.filePath ? path.resolve(options.filePath) : channelRegistryPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read CHANNEL_REGISTRY_PATH at ${filePath}`, { cause });
  }

  const configured = canonicalizeRegistry(registrySchema.parse(parsed));
  const requiredUris = [...new Set(Object.values(configured.channels).flatMap((channel) => channel.requiredEntities))];
  const resolved = await (options.resolveManifests ?? resolvePxManifests)(requiredUris);
  const entities = Object.fromEntries(resolved.map((entity) => [entity.id, entity]));

  // Write only after every URI has resolved successfully. A crash or failed
  // Px request leaves the previous valid cache untouched.
  const refreshed = { ...configured, entities, entitiesFetchedAt: new Date().toISOString() };
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(refreshed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
  registry = refreshed;
}

function requireRegistry(): ChannelRegistry {
  if (!registry) throw new Error("Channel registry has not been initialized.");
  return registry;
}

export function getChannelRegistry(): ChannelRegistry {
  return requireRegistry();
}

/** Test-only convenience that avoids touching the process-wide environment. */
export function setChannelRegistryForTests(value: unknown): void {
  registry = canonicalizeRegistry(registrySchema.parse(value));
}

export function getRequiredEntities(channelId: string): string[] {
  return requireRegistry().channels[channelId]?.requiredEntities ?? [];
}

export function getRequiredEntityManifests(channelId: string): unknown[] {
  const current = requireRegistry();
  return (current.channels[channelId]?.requiredEntities ?? [])
    .map((uri) => current.entities[uri])
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined);
}
