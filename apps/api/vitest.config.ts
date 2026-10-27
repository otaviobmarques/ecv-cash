import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [swc.vite({ jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  resolve: { alias: { '@ecv/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 20000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://ecv_app:app@localhost:5432/ecv_cash',
      NODE_ENV: 'test',
      EXPOR_CONVITE: 'true',
      ORIGENS_PERMITIDAS: 'http://app.test',
      URL_APP: 'http://app.test',
    },
  },
});
