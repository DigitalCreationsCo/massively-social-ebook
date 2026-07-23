# TypeScript Configuration in /admin

This package uses a split TypeScript configuration strategy, which is standard for modern Vite projects:

1.  **`tsconfig.json`**:
    *   **Purpose**: Type-checks your application source code (`src`) and `../shared` code.
    *   **Note**: It uses `"noEmit": true` because Vite uses `esbuild` for actual transpilation (speed). `tsc` is only used for verification.

2.  **`tsconfig.node.json`**:
    *   **Purpose**: Type-checks Vite configuration files (`vite.config.ts`, `vitest.config.ts`).
    *   **Reasoning**: Build tooling often requires different compiler options (e.g., node module resolution) than frontend source code. This separation ensures the build tool config is validated correctly without polluting the frontend configuration.
