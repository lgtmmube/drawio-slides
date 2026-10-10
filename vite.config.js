import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 48765, strictPort: true, watch: { usePolling: true, interval: 700, ignored: ['**/public/editor/**', '**/dist/**'] } },
  preview: { host: '127.0.0.1', port: 48765, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
