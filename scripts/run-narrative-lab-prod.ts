import './preload-prod';
import { spawn } from 'child_process';

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL, ensure the database is provisioned");
}

spawn("npx", [ "narrativeengine", "lab", "./server/blocks/ai.ts" ], {
    stdio: "inherit",
    env: {
        ...process.env,
        NODE_OPTIONS: '--import tsx --experimental-specifier-resolution=node',
        NARRATIVE_VERBOSE: "true"
    }
}); 