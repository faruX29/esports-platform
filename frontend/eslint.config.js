import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        // JSX-uses-vars eklentisi yok → sadece JSX'te kullanılan büyük-harfli
        // (Icon vb.) değişkenler "kullanılmıyor" sanılır; ^[A-Z_] onları da _ yer
        // tutucusunu da kapsar.
        destructuredArrayIgnorePattern: '^[A-Z_]',
        caughtErrors: 'none',
      }],
      // rules-of-hooks ERROR kalır (gerçek bug). Aşağıdaki yeni/çok-katı react-hooks
      // kuralları meşru desenleri de işaretliyor → warn (gerçek hatalar öne çıksın).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Fast Refresh (HMR) ipucu — dev deneyimi, runtime hatası değil.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Vercel Edge/serverless fonksiyonları Node/Edge ortamında çalışır → process, vb.
    files: ['api/**/*.js', 'middleware.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
