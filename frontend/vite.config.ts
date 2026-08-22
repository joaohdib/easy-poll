import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = Number(process.env.PORT) || 3000;

export default defineConfig({
  plugins: [react()],
  cacheDir: '../node_modules/.vite-easypoll',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`
    }
  }
});
