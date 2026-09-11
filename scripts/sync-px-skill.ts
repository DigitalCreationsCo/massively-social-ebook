import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PX_SDK_PACKAGE = "@portalshq/px";
const GENERATED_SKILL_DIRECTORY = path.resolve("server/blocks/generated");
const GENERATED_SKILL_PATH = path.join(GENERATED_SKILL_DIRECTORY, "px-skill.md");
const GENERATED_METADATA_PATH = path.join(GENERATED_SKILL_DIRECTORY, "px-skill.json");

interface NpmPackageMetadata {
  gitHead?: string;
  repository?: { url?: string } | string;
}

interface PackageLock {
  packages?: Record<string, { version?: string }>;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to sync the PX skill.`);
  }
  return value;
}

function normalizeGitHubRepository(repository: NpmPackageMetadata["repository"]): string {
  const repositoryUrl = typeof repository === "string" ? repository : repository?.url;
  const match = repositoryUrl?.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error(`The ${PX_SDK_PACKAGE} package does not declare a GitHub repository.`);
  }
  return match[1];
}

function assertGitCommit(commit: string | undefined): asserts commit is string {
  if (!commit || !/^[a-f0-9]{40}$/i.test(commit)) {
    throw new Error(`The ${PX_SDK_PACKAGE} package metadata does not declare a valid gitHead.`);
  }
}

async function fetchText(url: string, headers: HeadersInit = {}): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "massively-social-ebook-px-skill-sync", ...headers },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function readPxSdkVersion(): Promise<string> {
  const lockfile = JSON.parse(await readFile("package-lock.json", "utf8")) as PackageLock;
  const version = lockfile.packages?.[`node_modules/${PX_SDK_PACKAGE}`]?.version;
  if (!version) {
    throw new Error(`Unable to find ${PX_SDK_PACKAGE} in package-lock.json.`);
  }
  return version;
}

async function writeAtomically(destination: string, content: string): Promise<void> {
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, destination);
}

export async function syncPxSkill(): Promise<void> {
  const skillPath = requireEnvironmentVariable("PX_SKILL_GITHUB_PATH").replace(/^\/+/, "");
  const sdkVersion = await readPxSdkVersion();
  const packageMetadata = JSON.parse(
    await fetchText(`https://registry.npmjs.org/${encodeURIComponent(PX_SDK_PACKAGE)}/${sdkVersion}`),
  ) as NpmPackageMetadata;
  assertGitCommit(packageMetadata.gitHead);

  const repository = normalizeGitHubRepository(packageMetadata.repository);
  const githubToken = process.env.PX_SKILL_GITHUB_TOKEN?.trim();
  const skillContent = await fetchText(
    `https://raw.githubusercontent.com/${repository}/${packageMetadata.gitHead}/${skillPath}`,
    githubToken ? { authorization: `Bearer ${githubToken}` } : {},
  );

  if (!skillContent.trim()) {
    throw new Error("The downloaded PX skill is empty.");
  }

  await mkdir(GENERATED_SKILL_DIRECTORY, { recursive: true });
  await writeAtomically(GENERATED_SKILL_PATH, skillContent);
  await writeAtomically(
    GENERATED_METADATA_PATH,
    `${JSON.stringify({
      package: PX_SDK_PACKAGE,
      packageVersion: sdkVersion,
      repository,
      commit: packageMetadata.gitHead,
      path: skillPath,
      sha256: createHash("sha256").update(skillContent).digest("hex"),
      syncedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );

  console.log(`[PX] Synced ${skillPath} from ${repository}@${packageMetadata.gitHead}.`);
}

const invokedScript = process.argv[1];
if (invokedScript && import.meta.url === pathToFileURL(path.resolve(invokedScript)).href) {
  syncPxSkill().catch((error: unknown) => {
    console.error("[PX] Skill sync failed:", error);
    process.exitCode = 1;
  });
}
