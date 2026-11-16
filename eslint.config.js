import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'public/**', 'dist/**'] },
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: {
      // WXT 自动导入 onMounted 等 Vue API，未显式 import 不是错
      'no-undef': 'off',
      // 渐进收紧：先把解析能力和错误级规则跑起来，风格类后续再开
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
    },
  },
  {
    // shadcn-vue 约定：ui 原子组件单名（ui/button/Button.vue），豁免多词命名
    files: ['src/components/ui/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
);
