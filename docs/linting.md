# Линтер

ESLint 10 (flat config в [eslint.config.js](../eslint.config.js)) работает без baseline: все замечания исправлены, `npm run lint` запускается в CI с `--max-warnings=0`.

## Команда

| Команда | Что делает |
|---|---|
| `npm run lint` | Запускает `eslint . --max-warnings=0`. Любая ошибка или предупреждение валит проверку и CI. |

## Что проверяется

- `js.configs.recommended` — базовые правила JavaScript.
- `typescript-eslint` (`recommended`) в режиме без типовой информации (типы проверяют `npm run typecheck` и `npm run typecheck:tests`).
- `react-hooks/rules-of-hooks` (ошибка) и `react-hooks/exhaustive-deps` (предупреждение).
- `react-refresh/only-export-components` (предупреждение) для корректной горячей перезагрузки Vite.
