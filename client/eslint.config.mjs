import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import regexp from 'eslint-plugin-regexp';
import pluginImport from 'eslint-plugin-import';
import fontawesome6 from '../eslint-plugins/fontawesome6/index.js';
import reanimated from '../eslint-plugins/reanimated/index.js';
import reactnative from '../eslint-plugins/react-native/index.js';
import forbidEmoji from '../eslint-plugins/forbid-emoji/index.js';
import restrictLinearGradient from '../eslint-plugins/restrict-linear-gradient/index.js';
import expo from '../eslint-plugins/expo/index.js';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'api/**',           // 排除自动生成的 API 代码
      'src/api/**',       // 排除 src 下的自动生成 API
      '.expo/**',         // 排除 Expo 自动生成的文件
      'tailwind.config.js', // 排除 Tailwind 配置文件
      '**/*.d.ts',
      'eslint.config.*',
      'metro.config.*',
      './scripts/**',
    ],
  },
  regexp.configs["flat/recommended"],
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React 的推荐配置
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],

    // 语言选项：设置全局变量
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        '__DEV__': 'readonly',
      },
    },

    // React 版本自动检测
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json'],
          alwaysTryTypes: true,
        },
      },
    },

    plugins: {
      import: pluginImport,
      fontawesome6,
      reanimated,
      reactnative,
      forbidEmoji,
      restrictLinearGradient,
      expo,
    },
    rules: {
      // 关闭代码风格规则
      'semi': 'off',
      'quotes': 'off',
      'indent': 'off',
      "no-empty": ["error", { "allowEmptyCatch": true }],
      "no-unused-expressions": "warn",
      "no-useless-escape": "warn",
      'import/no-unresolved': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-prototype-builtins': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/display-name': 'off',
      'react/prop-types': 'off',
      'fontawesome6/valid-name': 'error',
      'reanimated/ban-mix-use': 'error',
      'forbidEmoji/no-emoji': 'error',
      'restrictLinearGradient/no-linear-gradient-backgroundcolor': 'error',
      'expo/require-globalcss-and-provider': 'error',
      // 禁止使用 via.placeholder.com 服务
      'no-restricted-syntax': [
        'error',
        {
          'selector': 'Literal[value=/via\\.placeholder\\.com/]',
          'message': 'via.placeholder.com 服务不可用，禁止在代码中使用',
        },
        {
          'selector': 'TemplateLiteral > TemplateElement[value.raw=/via\\.placeholder\\.com/]',
          'message': 'via.placeholder.com 服务不可用，禁止在代码中使用',
        },
      ],
      'reactnative/wrap-horizontal-scrollview-inside-view': ['error'],
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': 'error',
      'no-warning-comments': ['error', { terms: ['TODO'], location: 'start' }],
    },
  },

  {
    files: [
      "metro.config.js",
      "scripts/**/*.js",
      "expo/scripts/**/*.js",
      "eslint.config.js",
      "babel.config.js",
      "server/**/*.js"
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 在 .js 文件中关闭 TS 规则
      '@typescript-eslint/no-require-imports': 'off',
      // 在 Node.js 文件中允许 require
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'off',
    },
  },
];
