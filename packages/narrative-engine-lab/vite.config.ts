import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [ react() ],
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/__narrative_lab': {
        target: 'http://127.0.0.1:5002',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});