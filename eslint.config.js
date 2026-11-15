import globals from 'globals';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
    {
        ignores: ['icons/**', 'node_modules/**', '.output/**', '.wxt/**'],
    },
    {
        languageOptions: {
            ecmaVersion: 12,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                // 扩展运行时全局；经典脚本构造器已全部迁移为 Vue3 SFC + ESM composable
                chrome: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-console': 'off',
        },
    },
    eslintPluginPrettierRecommended,
];
