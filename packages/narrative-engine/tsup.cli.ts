import { defineConfig } from "tsup";

export default defineConfig({
  entry: [ "bin/cli.ts" ],
  format: [ "cjs", "esm" ],
  external: [ "narrative-engine-lab", "narrative-engine" ],
  treeshake: true,
});
