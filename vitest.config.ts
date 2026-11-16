import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 源码用 @/src/... 别名（WXT 的 .wxt/tsconfig.json 定义），测试里必须给 Vitest 同样的映射
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
  },
});
