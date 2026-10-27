import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@ecv/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  test: { environment: 'jsdom' },
});
