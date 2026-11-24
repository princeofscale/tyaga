import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat-конфигурация ESLint 10. TypeScript проверяется без типовой информации:
// полный type-aware режим требует project service и заметно медленнее, а типы
// и так проверяет `npm run typecheck`.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "artifacts/**",
      "android/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".wrangler/**",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        __APP_VERSION__: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Классические правила хуков. Пакет компилятора React не подключаем:
      // это отдельная миграция со своим набором находок, не часть этого прохода.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Игнорируем rest-siblings (`const { id, ...rest } = obj`) и явно помеченные `_arg`.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
      // Пустые catch допустимы, если они осознанно глушат ошибку хранилища.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["server/**/*.ts", "db/**/*.ts", "scripts/**/*.{ts,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["tests/e2e/**/*.{ts,tsx}"],
    rules: {
      // Playwright fixture API uses `use(...)`, which is not a React hook.
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
