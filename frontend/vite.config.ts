import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const backendPort = Number(process.env.PORT) || 3000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: '../node_modules/.vite-easypoll',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`
    }
  }
});
