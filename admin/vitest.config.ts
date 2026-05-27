import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    server: {
      deps: {
        inline: ['@shared'],
      },
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/api/client.ts',
        'src/hooks/usePolling.ts',
      ],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 60,
      },
    },
  },
})
