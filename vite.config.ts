import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Keep SQLite's WASM URL relative to its module during development.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  resolve: {
    alias: {
      '@lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/hooks', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Native filesystem events can miss edits made through workspace tools.
    watch: { usePolling: true, interval: 200 },
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
