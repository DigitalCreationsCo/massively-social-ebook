import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("CLI Loading Order", () => {
  const cliPath = resolve(__dirname, "../bin/cli.ts");
  const cliContent = readFileSync(cliPath, "utf-8");

  it("should load user config BEFORE starting lab server", () => {
    const configImportIndex = cliContent.indexOf("await import(absolutePath)");
    const labImportIndex = cliContent.indexOf('await import("narrative-engine-lab")');

    expect(configImportIndex).toBeGreaterThan(0);
    expect(labImportIndex).toBeGreaterThan(0);
    expect(configImportIndex).toBeLessThan(labImportIndex);
  });

  it("should await config import before importing lab", () => {
    const configImportIndex = cliContent.indexOf("await import(absolutePath)");
    const labImportIndex = cliContent.indexOf('await import("narrative-engine-lab")');

    expect(configImportIndex).toBeGreaterThan(0);
    expect(labImportIndex).toBeGreaterThan(0);
    expect(configImportIndex).toBeLessThan(labImportIndex);
  });

  it("should not import narrative-engine-lab before user config", () => {
    const lines = cliContent.split("\n");
    let userConfigLine = -1;
    let labImportLine = -1;

    lines.forEach((line, index) => {
      if (line.includes("import(absolutePath)")) {
        userConfigLine = index;
      }
      if (line.includes('import("narrative-engine-lab")')) {
        labImportLine = index;
      }
    });

    expect(userConfigLine).toBeGreaterThanOrEqual(0);
    expect(labImportLine).toBeGreaterThanOrEqual(0);
    expect(userConfigLine).toBeLessThan(labImportLine);
  });
});

describe("Registry Symbol", () => {
  it("should use Symbol.for for cross-module registry access", () => {
    const labPath = resolve(__dirname, "./lab.ts");
    const labContent = readFileSync(labPath, "utf-8");

    expect(labContent).toContain('Symbol.for("narrative.engine.registry")');
  });

  it("should export GLOBAL_KEY for registry access", () => {
    const labPath = resolve(__dirname, "./lab.ts");
    const labContent = readFileSync(labPath, "utf-8");

    expect(labContent).toContain("export const GLOBAL_KEY");
  });
});
