import { defineConfig } from "tsup";

export default defineConfig({
  entry: [ "bin/cli.ts" ],
  format: [ "cjs", "esm" ],
  treeshake: true,
});
