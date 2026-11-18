import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Порт і базовий шлях можна змінити змінними оточення; за замовчуванням клієнт працює на 5173 у корені сайту.
const port = Number(process.env.PORT ?? 5173);
const basePath = process.env.BASE_PATH ?? '/';
// Під час розробки запити /api передаються серверній частині (за замовчуванням http://localhost:5000)
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:5000';

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    fs: { strict: true },
  },
  preview: {
    port,
    host: '0.0.0.0',
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
});
