# 06 — PWA, офлайн и производительность

> Лог агента аудита «Тяга», 2026-11-24. Пишет только владелец этого файла.
> Формат записи: `[severity] файл:строка — суть → почему это проблема → что делать`.
> Severity: `BLOCKER` / `HIGH` / `MED` / `LOW` / `INFO`.

**Зона ответственности:** `scripts/serviceWorkerPlugin.ts`, `src/lib/offlineMutationQueue.ts`, `vite.config.ts`, размеры чанков, кэш-стратегии

---

## Мысли по ходу (черновик)

- Прочитал `scripts/serviceWorkerPlugin.ts` (135 стр.), `src/lib/offlineMutationQueue.ts` (109), `vite.config.ts` (46), `scripts/build-worker.mjs` (68), `src/main.tsx`, `src/components/AccountGate.tsx`, `lazyChunk.ts`, `HistoryList.tsx`, `HistoryScreen.tsx`, `ExerciseLibrary.tsx`, `ApiClient.ts`, `deviceAccountData.ts`, `offlineSnapshot.ts`, тест очереди.
- Собрал `npx vite build` (8.1 s, exit 0): dist/client 23 MB (из них 21.7 MB — два wasm mediapipe), dist/server 952 KB.
- Собрал временный конфиг в /tmp с плагином `generateBundle` → точная атрибуция модулей по чанкам (`renderedLength`): состав index.js, catalog, воркера.
- Посчитал precache: 58 записей / 65 файлов; не кэшируются только vision_*, *.wasm и licenses/ — намеренно.
- Прогнал анализ CSS: 5 файлов, 366 295 B; 94 уникальных класса отсутствуют в собранном JS; ~139 правил мертвы (≈12 KB, 3.3 %). 811 правил index.css (≈77 KB из 247 KB, 31 %) адресуют классы, которые встречаются только в ленивых чанках.
- Главное открытие раунда: в собранном `index.css` порядок `@layer` ПЕРЕВЁРНУТ. Проверил эмпирически в Chromium (Playwright) на реальном собранном CSS: `.search-field input` получает `padding: 11px 13px; font-size: 16px` от `base`, а не `13px 0 / 14px` от `screens`, потому что `@layer screens{...}` идёт первым блоком файла (offset 0), а `@layer tokens,base,layout,components,screens,utilities;` — только на offset 10942.
- Чанк-граф реального конфига: 0 циклов, 5 eager-чанков (index 430 KB, react 223, motion 139, catalog 105, icons 39) = 936 KB raw / 296 KB gzip до первого рендера.
- Воркер: 948 KB = 338 KB JSON-каталога wger + 119 KB клиентских данных каталога + 128 KB domain; drizzle-orm в рантайм НЕ попал.

## Находки

### 1. [HIGH] Порядок @layer в собранном CSS перевёрнут: base/layout бьют screens
- Где: `src/main.tsx:3-13` (импорт `AccountGate` раньше собственных CSS) + `src/styles/layers.css:1`; результат — `dist/client/assets/index-BFtGNvKi.css` offset 0 `@layer screens{...}`, offset 10942 `@layer tokens,base,layout,components,screens,utilities;`
- Что: Vite эмитит CSS в порядке обхода модулей; `main.tsx` сначала импортирует `AccountGate` → `App` → компоненты (которые тянут `workout.css` и др. в слое screens), и только потом `layers.css` с объявлением порядка. Chromium (проверено Playwright на реальном собранном CSS) ставит `screens` ниже `tokens/base/layout`: `.search-field input` (`screens.css:310`: `padding: 13px 0; font-size: .875rem`) вычисляется как `padding: 11px 13px; font-size: 16px` — побеждает `input, select` из `@layer base` (`base.css:44`).
- Почему плохо: слои сильнее специфичности, поэтому любое (в т.ч. будущее) правило base/layout молча перекрывает правила экранов. Уже сейчас ломается вид поиска в «Истории», полей и кнопок; визуальные тесты этого не ловят.
- Как чинить: объявить порядок слоёв до любого CSS — инлайновым `<style>@layer tokens,base,layout,components,screens,utilities;</style>` в `index.html` (до бандл-CSS), либо перенести импорт `./styles/layers.css` в начало `main.tsx` и убрать статический импорт `App`/поддерева выше него.
- Уверенность: подтверждено запуском (Playwright, реальный dist-CSS).

### 2. [HIGH] skipWaiting + мгновенное удаление старых кэшей ломает ленивые чанки в открытых вкладках
- Где: `scripts/serviceWorkerPlugin.ts:47` (`self.skipWaiting()` в install), `scripts/serviceWorkerPlugin.ts:51-63` (activate удаляет все старые `tyaga-shell-*`/`tyaga-catalog-*`), `src/main.tsx:36-38` (регистрация без `controllerchange`), `wrangler.production.jsonc` `not_found_handling: single-page-application`.
- Что: после деплоя новый SW активируется немедленно и удаляет старый кэш, пока открытая вкладка работает на старом JS. Запрос `/assets/<old-hash>.js` → в новом кэше нет → в сеть → файла в новом деплое нет → SPA-fallback отдаёт `index.html` с 200. `assetFirst` (стр. 102) ещё и кладёт этот HTML в кэш под URL скрипта.
- Почему плохо: пользователь, у которого вкладка пережила деплой, при первом открытии «Истории»/«Каталога»/«Программ» видит «Каталог не загрузился» + «Повторить» (lazyChunk.ts:19); лечится только перезагрузкой (lazyChunk.ts:27). Это происходит на каждом релизе у каждого, кто не закрыл вкладку.
- Как чинить: убрать `skipWaiting()` (новый SW берёт управление на следующей загрузке) ИЛИ хранить старые shell-кэши ещё N дней и не удалять кэш версии, которая обслуживает открытые клиенты; добавить `controllerchange → location.reload()` один раз.
- Уверенность: подтверждено чтением (код + конфиг прод-ассетов).

### 3. [HIGH] Офлайн-очередь зацикливает 4xx навсегда (401/403/400/422)
- Где: `src/lib/offlineMutationQueue.ts:92-104` (после `isRetryable` и 404/409 любой другой 4xx попадает в `remaining` с `error`), `src/App.tsx:201-206, 334-346`.
- Что: элемент с 400/401/403/422 не удаляется, а записывается обратно; `flush` вызывается на каждом старте, смене `loading/offlineData` и на `online`, и снова читает его из localStorage. Счётчик `pendingCount` (App.tsx:1623) не сбрасывается никогда, текста ошибки для мутаций в UI нет.
- Почему плохо: после истечения сессии (401) или изменения серверной валидации очередь навсегда «залипает», при каждом запуске шлёт те же запросы; вычистить можно только выходом из аккаунта (`deviceAccountData.wipe()`).
- Как чинить: считать 4xx (кроме 408/429) терминальным — удалять элемент и показывать «не удалось применить»; либо не более N попыток, хранить `attempts`.
- Уверенность: подтверждено чтением.

### 4. [HIGH] Ссылки «Скачать приложение для Android» ведут на несуществующий `/tyaga.apk`
- Где: `src/components/AccountGate.tsx:171`, `src/components/AccountProfileForm.tsx:477`, `src/components/RestNotificationSettings.tsx:48`; в `public/` и `dist/client/` APK нет, в CI (`.github/workflows/checks.yml`) шага копирования APK нет.
- Что: прод-ассеты с `not_found_handling: single-page-application` на отсутствующий `/tyaga.apk` отдают `index.html` с 200.
- Почему плохо: по кнопке скачивается HTML-файл с именем `tyaga.apk` (не устанавливается); на экране входа и в настройках уведомлений это тупик.
- Как чинить: класть APK в `dist/client` шагом сборки/деплоя (и в precache не надо), либо вести на конкретный URL релиза; проверять наличие файла.
- Уверенность: подтверждено чтением + инвентарём сборки. Оговорка: если APK кладут в прод вручную мимо репозитория — не подтверждено.

### 5. [MED] Precache атомарен: один сбойный запрос отменяет установку SW целиком
- Где: `scripts/serviceWorkerPlugin.ts:45-49` (`cache.addAll` 58 запросов без `catch`).
- Что: `addAll` отклоняется при любом не-2xx/сетевой ошибке одного файла; `skipWaiting` стоит в `.then()` после него, поэтому установка просто не завершается.
- Почему плохо: у нового пользователя при разовом сбое CDN офлайн не заработает вовсе (и не будет повторной попытки до следующей навигации); у старого — не приедет обновление, все остаются на старом SW.
- Как чинить: `Promise.allSettled` по каждому URL (или addAll в try/catch → добивать по одному), версию и активацию не блокировать единичным 404.
- Уверенность: подтверждено чтением.

### 6. [MED] Stale-while-revalidate для `/api/exercises` не привязан к `event.waitUntil` и кэширует каждый уникальный запрос
- Где: `scripts/serviceWorkerPlugin.ts:106-120, 128`.
- Что: при попадании в кэш функция сразу возвращает `hit`, а `network`-промис нигде не ждёт (`respondWith` завершён) — SW может быть убит до `cache.put`. Ключ — `request.url`, т.е. `?q=…&muscle=…&equipment=…&page=N&language=all` (ExerciseLibraryService.ts:26-35): каждая уникальная поисковая строка — отдельная вечная запись.
- Почему плохо: (а) после миграции каталога пользователь получает протухшие данные и не гарантированно обновляет кэш; (б) кэш растёт от каждого ввода в поиск (debounce не спасает от уникальных строк) вплоть до квоты; (в) инвалидация — только сменой VERSION, т.е. пересборкой клиента.
- Как чинить: `event.waitUntil(network)` в обработчике; кэшировать только «базовый» `/api/exercises` без query или ограничить число записей; при старте новой версии каталога чистить `tyaga-catalog-*`.
- Уверенность: подтверждено чтением.

### 7. [MED] Версия SW = хэш имён файлов, а не содержимого
- Где: `scripts/serviceWorkerPlugin.ts:31` (`createHash("sha256").update(files.sort().join("|"))`).
- Что: в хэш входят только пути. Файлы без контент-хэша в имени (`favicon.svg`, `manifest.webmanifest`, `index.html`) при изменении не меняют VERSION.
- Почему плохо: правка манифеста/иконки/мета-тегов без изменения имён ассетов не доедет до клиентов с установленным SW — они будут вечно видеть старый `manifest.webmanifest`/иконку из кэша.
- Как чинить: хэшировать пары «путь + содержимое» (readFileSync + update), либо `mtime+size`.
- Уверенность: подтверждено чтением.

### 8. [MED] Стартовый путь тянет всё приложение: логин-экран грузит workout-приложение целиком
- Где: `src/components/AccountGate.tsx:4` (`import App from "../App"`), `src/main.tsx:3`; атрибуция по `renderedLength` из моей сборки: index.js 430 KB raw / 148 KB gzip, react 223/69, motion 139/46, catalog 105/24, icons 39/7.7 → 936 KB raw / 296 KB gzip + CSS 44 KB gzip до первого рендера.
- Что: в index.js сидят `WorkoutView.tsx` 78 KB, `src/assets/anatomy/muscle-map.json` 62 KB (импортируется `BodyMap.tsx:6`), `App.tsx` 58 KB, `LaidDupPlan.ts` 33 KB, `BodyMap` 30 KB, `@capacitor/core` 24 KB (статический импорт `services/RestTimerService.ts:1-5` через `hooks/useRestNotifications`).
- Почему плохо: неавторизованный пользователь (первый визит с рекламы/ссылки) скачивает и парсит всё приложение, включая JSON анатомии, чтобы увидеть форму входа; `@capacitor/core` в веб-PWA вообще мёртвый код.
- Как чинить: `const App = lazy(() => import("../App"))` за Suspense в AccountGate; `@capacitor/core` — только динамическим импортом внутри `isNativePlatform()`; `muscle-map.json` — `fetch()` по требованию или отдельный lazy-чанк.
- Уверенность: подтверждено запуском (temps-конфиг с per-module stats) + чтением.

### 9. [MED] 77 KB (31 %) eager-CSS обслуживают только ленивые экраны
- Где: `src/main.tsx:13` (`import "./styles/screens.css"`) — 199 KB исходника в index-чанк; расчёт по собранному CSS: 811 правил index.css адресуют классы, которых нет в eager-JS, 76 970 B из 247 591 B.
- Что: `.history-*`, `.exlib-*`, `.import-*`, `.live-*`, `.detail-*` и т.п. едут в критическом CSS, хотя соответствующие экраны — lazy (chunks.tsx:12-27).
- Почему плохо: +~14 KB gzip и лишний парсинг CSS на первом рендере у всех пользователей, включая тех, кто эти экраны не открывает.
- Как чинить: разрезать `screens.css` по экранам и импортировать рядом с компонентами (как уже сделано для programs/progress/friends/supplements), оставив в eager только общий каркас и workout.
- Уверенность: подтверждено запуском (скрипт сравнения классов).

### 10. [MED] Мёртвый CSS и мёртвые компоненты «Вместе»/«Встречи»
- Где: `src/styles/progress.css` (`.bw-*` — 82 класса, 47 без использования), `src/styles/friends.css` (`.challenge-*`, `.meetup-*`); сами компоненты `src/components/TeamChallenges.tsx` и `src/components/TrainingMeetups.tsx` нигде не импортируются (грепом: только самоссылки и type-импорт в `domain/FriendsService.ts:1`).
- Что: ≈139 правил (≈12 KB raw, 3.3 % всего CSS) не имеют ни одного класса в собранном JS; 94 уникальных класса мертвы. Примеры: `bw-chart-box`, `bw-tooltip`, `bw-hero-card` (BodyweightModal давно на `bw-hero`/`tel-*`), `meetup-card`, `challenge-card`.
- Почему плохо: мёртвый CSS грузится пользователю (FriendsScreen CSS — при открытии «Напарников», progress.css — при открытии прогресса и модалки веса), а мёртвые компоненты создают иллюзию фичи и риск случайного оживления.
- Как чинить: удалить мёртвые правила из progress.css/friends.css и либо удалить TeamChallenges/TrainingMeetups, либо подключить их осознанно.
- Уверенность: подтверждено запуском + чтением.

### 11. [MED] «История» рисует все карточки всех месяцев; memo нет
- Где: `src/components/HistoryList.tsx:240-259` (все группы и все карточки в DOM), `src/components/HistoryList.tsx:105-116` + CSS `src/styles/screens.css:4766-4773` (`content-visibility: auto` — только ленивая раскраска, не виртуализация); `src/features/history/HistoryScreen.tsx:175` (`renderItem={(w, records) => renderSession(w, records)}` — новая функция на каждый рендер).
- Что: React создаёт DOM-узлы для всех тренировок (при 500+ тренировках это десятки тысяч узлов), `HistoryList`/`HistoryScreen` не мемоизированы, поэтому любой ре-рендер App (тост, изменение настроек, черновик) перерисовывает весь список.
- Почему плохо: открытие «Истории» и последующие ре-рендеры дают заметные подвисания на средних Android; content-visibility убирает layout/paint, но не создание узлов и не diff.
- Как чинить: рендерить месяцы порциями (IntersectionObserver + «Показать ещё») или виртуализировать; обернуть карточку в `memo`, а `renderItem` — в `useCallback` наверху.
- Уверенность: подтверждено чтением.

### 12. [MED] ExerciseLibrary пересчитывает поиск и фильтры на каждый рендер
- Где: `src/components/ExerciseLibrary.tsx:197-223` (`filteredLocal`, `exerciseCatalog.search({...})`, `gapsShown` — без `useMemo`), строка 606 (рендер всех найденных).
- Что: для source="tyaga" каждый рендер (ввод в поиск, любой ре-рендер родителя) заново прогоняет полнотекстовый поиск и фильтры по каталогу, плюс `zones(e)` на каждую карточку.
- Почему плохо: на каждый символ — O(N) по каталогу и аллокации; при 69 curated-записях терпимо, но при росте каталога станет заметно; лишние ре-рендеры карточек.
- Как чинить: `useMemo` по `[search, debounced, muscle, equipment, source, personal, favorites]`, карточку — в `memo`.
- Уверенность: подтверждено чтением.

### 13. [MED] Воркер 948 KB: 338 KB встроенного JSON-каталога + клиентские данные каталога
- Где: `server/wgerCatalog.ts:1` (`import fallback from "../data/wger/fallback-snapshots.json"`), `scripts/build-worker.mjs:6-30` (при отсутствии `data/wger/catalog-v{1,2,3}*.json` — а их в репозитории нет — подстановка не срабатывает), `dist/server/index.js` 967 526 B.
- Что: по метафайлу esbuild: `data/wger/fallback-snapshots.json` 338 KB (35 %), `src/domain` 128 KB, `src/data` 119 KB (catalog-v1/v2/v3, muscles, aliases, evidence — те же данные, что и в клиентском catalog-чанке), серверный код ~230 KB. `drizzle-orm` в бандл НЕ попал (только упоминание в комментарии `server/SyncService.ts:3`) — деревошейвинг зависимостей работает.
- Почему плохо: холодный старт/размер воркера и лимиты CF; каталог грузится в память изолята целиком; данные каталога дублируются между клиентом (105 KB) и воркером (457 KB).
- Как чинить: держать снимок каталога в D1/R2/ассете и читать по требованию, либо не включать fallback при наличии полного каталога (сейчас условие всегда false, т.к. JSON-файлов в `data/wger/` нет). `src/data/catalog-*` в воркере оставить только то, что реально нужно для валидации.
- Уверенность: подтверждено запуском (esbuild --metafile).

### 14. [LOW] Два параллельных flush отправляют одни и те же мутации
- Где: `src/App.tsx:334-346` (эффект по `loading/offlineData` + отдельный `online`-листенер) → `src/App.tsx:201-206` → `offlineMutationQueue.ts:79-108` (нет in-flight-блокировки: оба вызова читают один снимок до записи).
- Что: при «онлайн + перезагрузка данных» одновременно стартуют два `flush`, оба читают очередь и оба шлют одинаковые PUT/DELETE.
- Почему плохо: дубли запросов; для DELETE второй получает 404 (обрабатывается), для PUT идемпотентно — поэтому не BLOCKER, но тосты «синхронизированы» дублируются, а при появлении POST-мутаций это станет дублем данных.
- Как чинить: `if (flushing.current) return` в `flushMutations` или mutex внутри `flush`.
- Уверенность: подтверждено чтением.

### 15. [MED] 409 на отложенном удалении молча выбрасывает операцию
- Где: `src/lib/offlineMutationQueue.ts:97-101` (404/409 → `failed++`, элемент удаляется), `src/App.tsx:983-993` (оптимистично убирает тренировку из списка).
- Что: удаление ушло в очередь с `revision` на момент постановки; если тренировку изменили на другом устройстве, сервер вернёт 409, и очередь просто забывает операцию. Локально запись уже скрыта.
- Почему плохо: пользователь уверен, что удалил, а на сервере запись жива; расхождение всплывёт только после перезагрузки (`load()`) — и то молча.
- Как чинить: на 409 перечитывать актуальную запись/показывать конфликт (как это уже сделано для онлайн-удаления в App.tsx:995-999), а не глотать.
- Уверенность: подтверждено чтением (поведение зафиксировано тестом `tests/offline-mutation-queue.test.ts:34-52`).

### 16. [MED] iOS-иконка и splash указывают на SVG
- Где: `index.html:13-14` (`apple-touch-icon` и `apple-touch-startup-image` → `/favicon.svg`), `public/manifest.webmanifest` (единственная иконка — SVG, `"purpose": "any maskable"`).
- Что: iOS не поддерживает SVG для `apple-touch-icon`/splash; для Home Screen нужен PNG (180×180 и набор splash).
- Почему плохо: при «Добавить на экран Домой» на iPhone иконка будет пустой/скриншотом; гид `IosInstallPrompt` ведёт к неполноценной установке.
- Как чинить: добавить PNG-иконки (180/192/512 + maskable) и PNG splash с media-queries.
- Уверенность: подтверждено чтением.

### 17. [LOW] navigate/assetFirst кладут в кэш что угодно с кодом 200 и не ждут cache.put
- Где: `scripts/serviceWorkerPlugin.ts:72-94` (`cache.put("/", response.clone())` без `event.waitUntil`), `:96-104` (`assetFirst` кэширует любой 200, включая HTML SPA-fallback под URL скрипта).
- Что: ответ 200 не проверяется на content-type в `assetFirst`; `cache.put` не привязан к времени жизни события.
- Почему плохо: отравление кэша (HTML под .js), плюс обновление shell/ассетов может не успеть записаться — тогда кэш не отражает реальность до следующего визита.
- Как чинить: проверять content-type для /assets/, оборачивать записи в `event.waitUntil`.
- Уверенность: подтверждено чтением.

### 18. [LOW] У очереди нет лимита размера/срока, а ошибка записи в flush игнорируется
- Где: `src/lib/offlineMutationQueue.ts:55-66, 106` (`write()` возвращает boolean, `flush` его не проверяет), `read()` без TTL и без ограничения количества.
- Что: элементы живут вечно (нет `queuedAt`-срока), при `QuotaExceededError` `write` молча провалится и очередь потеряет остаток.
- Почему плохо: при забитом localStorage (черновики, вес, снапшот) офлайн-правки могут пропасть без сообщения.
- Как чинить: TTL (например 30 дней) + лимит N записей; при неудачной записи показывать ошибку.
- Уверенность: подтверждено чтением.

### 19. [INFO] Ленивые экраны без skeleton, но с понятным fallback
- Где: `src/App.tsx:1451,1478,1517,1540` (`<p role="status">Открываем историю…</p>`), `src/components/lazyChunk.ts:10-19` (ChunkFailed с «Повторить»).
- Что: при загрузке чанка показывается строка статуса, скелетона нет; при отказе — карточка с повтором, без падения дерева.
- Почему плохо: не проблема (CLS от подмены абзаца на экран минимален), но выглядит дёшево на медленной сети.
- Как чинить: при желании — skeleton-плейсхолдеры под экран.
- Уверенность: подтверждено чтением.

### 20. [INFO] Lazy-загрузка motion-фич — пустая операция
- Где: `src/main.tsx:14-15,26` + `src/lib/motionFeatures.ts:1-2` (`export { domMax } from "motion/react"` — на деле `import { domMax } from "motion/react"`); чанк `motionFeatures-*.js` = 0.09 KB.
- Что: `domMax` уже лежит в eager-чанке `motion` (139 KB / 46 KB gzip), который modulepreload-ится в index.html; динамический импорт ничего не отделяет, а `domMax` — самый полный набор фич.
- Почему плохо: размер motion не оптимизирован; иллюзия код-сплита.
- Как чинить: `domAnimation` вместо `domMax` (если layout/drag не нужны) или убрать `LazyMotion`-обвязку.
- Уверенность: подтверждено чтением + размером чанка.

## Что проверил и НЕ подтвердилось

- **Мутации не кэшируются SW**: `scripts/serviceWorkerPlugin.ts:124` — `if (request.method !== "GET") return;`; POST/PUT/DELETE вообще не перехватываются. Очередь — единственный механизм.
- **Циклических чанков и дублирования в manualChunks нет**: собрал реальный `vite build` (warnings нет), распарсил статический граф чанков — 0 циклов; eager-замыкание от index.js = ровно 5 чанков (react/motion/icons/catalog + index). Паттерн `/node_modules/motion` корректно ловит `motion-dom`/`motion-utils`.
- **Sourcemap в проде не утекает**: `vite.config.ts:19` — `sourcemap: false`; в dist нет ни одного `.map`.
- **`assetsInlineLimit` не сломан**: Vite 6 (`node_modules/vite/dist/node/chunks/dep-3O3b9SCF.js:10612-10619`) при `undefined` берёт дефолт 4096, `false` для woff2 — шрифты остаются файлами. Заявленное поведение соблюдено.
- **drizzle-orm в рантайме воркера НЕТ**: метафайл esbuild не содержит модулей `drizzle-orm`; `drizzle` в `server/SyncService.ts:3` — только комментарий. Есть только в devDependencies.
- **Виртуализация ExerciseLibrary не нужна**: каталог 854 упражнения отдаётся сервером страницами по 24 (`ExerciseLibrary.tsx:696-720`), локальный curated-каталог = 69 записей (38 в v3 + 31 в v2), все рендерятся сразу — это нормально.
- **content-visibility на длинных списках есть и сделана правильно**: `screens.css:4766-4773` (месяцы истории, `contain-intrinsic-size: auto 640px`, отключение в `history-exact`), `workout.css:2004-2010` (карточки упражнений, fallback `contain: layout style paint`).
- **Шрифты не дают CLS**: `src/styles/fonts.css:1-64` — у всех `@font-face` `font-display: swap` и разбиение по unicode-range; preload нет, но и блокировки рендера нет. Замечание только информационное: `main.tsx:5` тянет `@fontsource-variable/jetbrains-mono/wght.css` со всеми сабсетами (greek/vietnamese не скачиваются благодаря unicode-range).
- **Атомарность версии при изменении только контента un-hashed файлов** — частный случай п.7; отдельной поломки «старый клиент после деплоя JS» не нашёл: имена чанков меняются, VERSION меняется, activate чистит старые кэши.
- **Тестов на service worker / precache нет** (`tests/` не содержит `serviceWorkerPlugin`/`sw.js`), поэтому п.5-7,17 не застрахованы регрессией — это наблюдение, а не находка.
