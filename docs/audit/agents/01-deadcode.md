# 01 — Мёртвый код и legacy

> Лог агента аудита «Тяга», 2026-11-24. Пишет только владелец этого файла.
> Формат записи: `[severity] файл:строка — суть → почему это проблема → что делать`.
> Severity: `BLOCKER` / `HIGH` / `MED` / `LOW` / `INFO`.

**Зона ответственности:** неиспользуемые файлы/экспорты/ассеты, legacy-каталоги v1/v2, дубли справочников, `data/`, `src/data/`, `src/lib/`

---

## Мысли по ходу (черновик)

- База: `/Users/princeofscale/Desktop/gym/tyaga-agent-evolution`, HEAD `aef5f82`, ветка main. `dist/client` пересобран 2026-11-24 10:24 (не мной) — размеры чанков сняты с него.
- Импорт-граф собран скриптом в `/tmp/tyaga-deadcode.mjs`: 354 файла (`src`, `server`, `tests`, `scripts`, `db`, `drizzle` + корневые конфиги), 1272 ребра импорта, 639 экспортов, 0 неразрешённых относительных импортов. Скрипт не в репозитории.
- Отдельно проверены ложные срабатывания статического сканирования: `new Worker(new URL(...))`, `import.meta.glob`, entrypoint'ы в wrangler-конфигах, `React.lazy` из `src/components/chunks.tsx` — все учтены вручную.
- Git-история: `03ff1d0` снял рендер `TeamChallenges` и `TrainingMeetups` из `FriendsScreen` (`git show 03ff1d0 -- src/components/FriendsScreen.tsx`: строки `-import TeamChallenges...`, `-import TrainingMeetups, { WeeklyGoal }...`, `-<TrainingMeetups ...>`, `-<TeamChallenges ...>`), но сами компоненты, API и e2e-тесты остались. `aef5f82` эти тесты не трогал.
- Самый серьёзный результат: два живых e2e-сценария проверяют удалённый UI, поэтому зелёный `test:e2e` на main невозможен без восстановления UI или удаления тестов. `test-results/playwright/.last-run.json` показывает `passed`, но это след точечного прогона — полный Playwright я не запускал (не моя зона и дорого).
- Дубли искал измерением: Jaccard по множествам нормализованных строк. Ни одна пара `src/**` с ≥40 строк не дала >0.35; у подозреваемых пар 0.01–0.09. Т.е. «дублей-клонов» в src нет, есть общий домен + разные слои.
- Legacy-каталоги: скрипт пересечения id. v1 = 26 id, v2 = 31, v3 = 38; v1∩v2 = 21, v1-only = 5 (`facepull`, `lunge`, `legcurl`, `hipthrust`, `calf`), v2∩v3 = 0, v3-only = 38. v2 — не legacy, а действующая база (v3 аддитивен).
- Снапшоты wger разобрал структурно: это не три копии одного JSON, а три релиза с id вида `wger:<sourceId>:<contentHash>`; v2 и v3 совпадают по содержимому только у 12 из 38 записей.
- Время: на каждую запись ниже — чтение кода; если что-то не запускал (Playwright, сборку), это указано в «Уверенность».

## Находки

### 1. [HIGH] E2E-тесты челленджей и встреч проверяют UI, которого больше нет
- Где: `tests/e2e/daily-workflow.spec.ts:328` (встречи: `Моя цель на неделю` :333/:338, `Позвать на тренировку` :341, `Начать вместе` :360, `Общий итог: 1 участник` :390) и `tests/e2e/daily-workflow.spec.ts:575` (челленджи: `Создать челлендж` :624, `.challenge-card` :642, `Обновить челленджи` :654).
- Что: все эти строки/классы встречаются в репозитории **только** в мёртвых `src/components/TrainingMeetups.tsx` и `src/components/TeamChallenges.tsx`. `src/components/FriendsScreen.tsx` их не импортирует (grep по `TeamChallenges|TrainingMeetups|challenge|meetup` — 0 совпадений), в собранном `dist/client/assets/FriendsScreen-*.js` строк `челлендж`/`challenge` нет; `challenge-*` остались только в CSS. Оба теста — обычные `test(...)` без `skip`, `testDir` в `playwright.config.ts:6` — весь `tests/e2e`. Git: `03ff1d0` удалил рендер и импорты из FriendsScreen, тесты не тронуты.
- Почему плохо: `npm run test:e2e` (и job `e2e` в `.github/workflows/checks.yml:33-46`) падает на двух сценариях — main не может быть зелёным по CI; при этом тесты маскируют реальную дыру (фича вырезана, а не сломана).
- Как чинить: решить судьбу фичи. Либо вернуть `<TrainingMeetups>`/`<TeamChallenges>` в FriendsScreen, либо удалить оба теста вместе с компонентами; промежуточный вариант — пометить `test.fixme` с причиной, но это только скрывает.
- Уверенность: подтверждено чтением (код + git + бандл). Playwright не запускал.

### 2. [MED] Пять компонентов-призраков: ~1083 строк UI без единого импорта
- Где (все — 0 импортов во всём репозитории, включая тесты и `chunks.tsx`):
  - `src/components/TeamChallenges.tsx:13` — 477 строк / 17 404 B (default export, плюс единственное использование `TeamChallengeProgress` только внутри);
  - `src/components/TrainingMeetups.tsx:57` — 460 строк / 17 690 B; внутри ещё `WeeklyGoal` (`:21`), тоже 0 использований;
  - `src/components/ExecutionFields.tsx:3` — 97 строк / 3 081 B;
  - `src/components/motion/useHeroStage.ts:17` — 74 строки / 3 045 B (единственное упоминание — `docs/design-iron.md:29`);
  - `src/components/TrainingPlate.tsx:4` — 60 строк / 4 178 B (SVG-пластина; рядом лежит неиспользуемый `src/assets/steel-plate.webp`, см. №5).
- Что: файлы компилируются (`tsc` их видит), но не входят ни в один чанк — в `dist/client/assets` их нет; typecheck/lint молчат, поэтому код дрейфует от типов незаметно.
- Почему плохо: ~1 тыс. строк ложных сигналов для ревью и агентов; при удалении «мёртвого UI» легко зацепить живой домен/API (см. №3).
- Как чинить: удалить 5 файлов одним коммитом, предварительно решив №1/№3 (`ExecutionFields`, `TrainingPlate`, `useHeroStage` можно удалять сразу — за ними ничего нет).
- Уверенность: подтверждено чтением + импорт-граф + бандл.

### 3. [MED] Челленджи и встречи: живой API/БД/домен без экрана — «полуудалённая» фича
- Где: `server/index.ts:74-80` (`/api/challenges` GET/POST/PUT → `new ChallengeRepository`), `server/index.ts:110-112` (чтение `meetups` в `/api/friends`), `server/index.ts:127-128` (POST/PUT `/api/friends/meetups`); `server/ChallengeRepository.ts:19` (266 строк), `server/MeetupRepository.ts:23` (278 строк); таблицы `team_challenges`, `challenge_participants`, `training_meetups`, `meetup_participants` в `db/schema.ts`; домен `src/domain/TeamChallenge.ts`, `src/domain/TrainingMeetups.ts`.
- Что: API-часть полностью подключена к Worker и защищена (сессия + Origin/JSON + участие/дружба проверяются в репозиториях), БД пишется. UI-часть — мёртвые `TeamChallenges.tsx`/`TrainingMeetups.tsx`. `FriendsScreen.tsx` не содержит ни слова про челленджи/встречи. При этом `src/App.tsx:911-917` всё ещё умеет завершать встречу: `if (draft.meetupId && !draft.editing) ... PUT /api/friends/meetups/<id>` — путь достижим только из старого черновика.
- Почему плохо: (а) пользователь может писать в эти таблицы только старым клиентом; новые данные никто не увидит; (б) удаление API «заодно с UI» уничтожит данные и сломает `tests/challenges-api.test.ts`, `tests/daily-workflow-api.test.ts:120`; (в) непонятно, фича выпилена намеренно или потеряна при редизайне `03ff1d0`.
- Как чинить: зафиксировать решение. Возврат UI — самый дешёвый путь (компоненты целы, тесты уже написаны). Удаление — только одним коммитом: UI + e2e-тесты + API-роуты + репозитории + домен + миграции (данные потеряются — нужен бэкап).
- Уверенность: подтверждено чтением.

### 4. [LOW] `src/lib/zoneCredit.ts` живёт только ради теста
- Где: `src/lib/zoneCredit.ts:6` (`zoneCreditNote`, 10 строк); единственный потребитель — `tests/round-01.test.ts:150,153-155`.
- Что: `git log -S zoneCredit` — функция была в UI до `aef5f82` (декомпозиция App.tsx), после чего осталась только в тесте. Это не «используется тестом», а «удалена из продукта, тест остался».
- Почему плохо: тест зелёный, а функции в UI нет — покрытие создаёт ложное ощущение живой фичи; 1 КБ мёртвого кода.
- Как чинить: удалить `zoneCredit.ts` и блок в `round-01.test.ts`; либо вернуть пояснение в UI (если оно там нужно).
- Уверенность: подтверждено чтением + git.

### 5. [LOW] `src/assets/steel-plate.webp` (171 598 B) не используется
- Где: `src/assets/steel-plate.webp`; grep `steel-plate`/`webp` по репозиторию — 0 ссылок в коде/CSS/HTML; в `dist` файла нет (Vite его не бандлит).
- Что: остаток прежнего «героя дня» (вместе с `useHeroStage`/`TrainingPlate`, №2). Пользователю не отправляется, вес только в git/чекауте.
- Почему плохо: 168 KiB мёртвого бинаря; вводит в заблуждение при поиске ассетов героя.
- Как чинить: удалить файл (история в git сохранит); проверить, что дизайн-доки `docs/design-iron.md` не обещают его как рабочий ассет.
- Уверенность: подтверждено чтением + grep + dist.

### 6. [LOW] Две неиспользуемые зависимости шрифтов + устаревшие доки о шрифтах
- Где: `package.json:36-38` — `@fontsource-variable/onest`, `@fontsource/fira-sans-extra-condensed`, `@fontsource-variable/jetbrains-mono`; импортируется только последний — `src/main.tsx:5`. Все реальные @font-face — локальные woff2 в `src/styles/fonts.css:1-64` (Golos Text, Sofia Sans Condensed).
- Что: Onest (216 K) и Fira Sans Extra Condensed (5.4 M в node_modules) не импортируются нигде; их лицензии остались в `public/licenses/third-party.txt:256,354`. `README.md:65`, `docs/design-and-catalog.md:9` и `THIRD_PARTY_NOTICES.md:17` описывают Fira/Onest как действующие — это ложь о текущем дизайне (`docs/design-steel.md:22` описывает Golos/Sofia правильно).
- Почему плохо: `npm ci` тянет ~5.6 МБ лишнего; новые агенты верят README и добавляют/правят не те шрифты.
- Как чинить: убрать 2 пакета из `package.json`, обновить 3 абзаца доков (или наоборот — вернуть Fira/Onest, если редизайн не финальный).
- Уверенность: подтверждено чтением + grep.

### 7. [LOW] `Sparkline` — мёртвый экспорт внутри живого `Charts.tsx`
- Где: `src/components/Charts.tsx:55` (31 строка, до `:84`); grep `Sparkline` по репозиторию — только объявление.
- Что: компонент не импортируется ни одним экраном/тестом; остальные экспорты `Charts.tsx` живые.
- Почему плохо: мёртвый код в живом модуле не виден линтеру и переживает рефакторинги.
- Как чинить: удалить функцию (или добавить в тот экран, где спарклайн задумывался).
- Уверенность: подтверждено чтением + grep.

### 8. [INFO] Мёртвые экспорты: 20 «совсем», 81 «только внутри файла» — мёртвых функций в domain/server нет
- Где: полный список в `/tmp/tyaga-deadcode.json` (не в репо). Совсем не используются: `WeeklyGoal` (`TrainingMeetups.tsx:21`, уйдёт с файлом), `TeamChallenges` (default, уйдёт с файлом), `E1RM_FORMULA_VERSION` (`src/lib/model.ts:38`), `CATALOG_REVISION` (`src/lib/catalog.ts:10`), `Sparkline` (`Charts.tsx:55`), 12 экспортов таблиц `db/schema.ts` (см. №9).
- Что: 81 экспорт используется только в своём файле — это не мёртвый код, а лишняя публичная поверхность (снимать только `export`): `LaidDupPlan` 4 типа, `SmartCoach` 6, `BiomechanicsEngine` 4, `PersonalRecords` 3, `VolumeLandmarks` 3, `WorkoutImport` 2, `LiveSession` 2, `BodyweightTracker` 2 и т.д. Например `server/validation.ts:416 validExecution` «мёртвым» не является — вызывается на `:151` и `:215`.
- Почему плохо: не влияет на бандл после tree-shaking типов, но раздувает API модулей и мешает отличать реально мёртвое.
- Как чинить: не трогать; при случае снять `export` у 81 символа (механическая правка, риск нулевой). Для `E1RM_FORMULA_VERSION`/`CATALOG_REVISION` решить: либо использовать в UI/аналитике, либо удалить.
- Уверенность: подтверждено скриптом + выборочным чтением (LaidDupPlan, SmartCoach, validation.ts, model.ts).

### 9. [INFO] `db/schema.ts`: 14 экспортов не читаются TypeScript-кодом, но удалять их нельзя
- Где: `db/schema.ts` (322 строки): `catalogReleases`, `catalogMemberships`, `favoriteExercises`, `authLimits`, `socialProfiles`, `workoutKudos`, `bodyweightDocuments`, `trainingMeetups`, `meetupParticipants`, `teamChallenges`, `challengeParticipants`, `liveMembers` и др. — 0 обращений по имени в `src/`/`server/`.
- Что: файл читает `drizzle-kit` как схему (`drizzle.config.ts:2`) и `tests/migration-integrity.test.ts:11` (`import * as schema`); таблицы могут использоваться сырым SQL в репозиториях. Это «мёртвые экспорты, живые таблицы».
- Почему плохо: соблазн удалить «неиспользуемое» ломает генерацию миграций.
- Как чинить: ничего не удалять; если таблицы действительно не нужны — отдельная миграция `DROP TABLE` + удаление из схемы, не в рамках чистки кода.
- Уверенность: подтверждено чтением + grep.

### 10. [MED] Legacy-каталог: v2 удалять нельзя, у v1 пять уникальных id; runtime-вес чанка 105 KB (24.2 KB gzip)
- Где: `src/data/catalog-v1.ts:4`, `src/data/catalog-v2.ts:148`, `src/data/catalog-v3.ts:165`, `src/lib/catalog.ts:2-4,10-16,42-44`, `src/lib/model.ts:64` (`legacyMuscleLoad`), `src/components/WorkoutDetailModal.tsx:209-217`.
- Что (измерено скриптом): v1 — 26 id, v2 — 31, v3 — 38. v1∩v2 = 21; **v1-only = 5: `facepull`, `lunge`, `legcurl`, `hipthrust`, `calf`**; v2∩v3 = 0 (v3 аддитивен, `catalog-v3.ts:13-17`); v3-only = 38. `lib/catalog.ts:12` всегда собирает `EXERCISES = [...CATALOG_V2, ...CATALOG_V3]`; v1 идёт только в `legacy` массив `ExerciseCatalog` (`:16-41`). `ExerciseCatalog.find` (`src/domain/ExerciseCatalog.ts:34-37`) для неизвестного id откатывается на revision 1 — т.е. 5 v1-only id резолвятся только благодаря v1. `legacyMuscleLoad` рендерится в `WorkoutDetailModal` только при `(e.catalogRevision ?? 1) === 1` (`:209`), т.е. для записей до каталога 2.
- Runtime-вес (dist от 10:24): `catalog-B1DJjuV7.js` = 105 239 B, gzip 24 215 B; в нём есть и v1-маркер `legacy_unspecified`, и v1-only id `hipthrust`, и v2 id `incline-db` — т.е. весь legacy-слой грузится всегда при импорте `lib/catalog` (чанк `catalog` по `vite.config.ts:36-40`).
- Почему плохо: удаление v2 мгновенно ломает 31 действующее упражнение (историю, программы, импорт) — это BLOCKER-по-последствиям, не «чистка». Удаление v1 ломает отображение старых записей (5 id вообще перестанут резолвиться) и убирает «Архивный расчёт · методика 1».
- Как чинить: v2/v3 не трогать. v1 удалять только после проверки прод-D1 на записи с `catalogRevision = 1` или id из 5 v1-only (без этого — оставить). Если решите оставить v1 — он стоит ~несколько КБ в чанке, приемлемо.
- Уверенность: подтверждено скриптом + чтением + размером чанка.

### 11. [INFO] `data/wger/fallback-snapshots.json` — это архив трёх релизов, а не три дубля
- Где: `data/wger/fallback-snapshots.json` (338 343 B на диске / 274 950 символов), читается только `server/wgerCatalog.ts:1-14` и через него `server/ExerciseRepository.ts:2-4,234-236` (+ `tests/product.test.ts`, `tests/session-report.test.ts`).
- Что: верхний уровень — `{v1, v2, v3}`, в каждом по 38 записей, одинаковые `provider/sourceUrl/fetchedAt/upstreamCount`, разные `release` (wger-3271…, wger-ru-30f1…, wger-ru-review-0114…). id записи = `wger:<sourceId>:<contentHash>`, поэтому: v1∩v3 по id = 0, v2∩v3 = 12 (у всех 12 совпадает `contentHash` и всё содержимое), v2-only = 26, v1 с v3 не совпадает ни одной записью. v2 добавляет `localization`, v3 — `review`+локализацию. Все три нужны: `ExerciseRepository.ts:234-236` поднимает `previousData`/`previousRuData` для архивных wger-id.
- Почему плохо: «дубль» здесь — только 12 записей, повторённых в v2 и v3 (десятки КБ); удаление любого релиза сломает резолв старых `wger:*` id в истории.
- Как чинить: не удалять; максимум — дедуплицировать общие 12 записей ссылкой при следующей генерации снапшотов. Отдельно: `fetchedAt` у всех трёх одинаковый (2026-10-07T05:33:32.053Z) — похоже на артефакт генератора, стоит проверить, но на код не влияет.
- Уверенность: подтверждено скриптом + чтением.

### 12. [INFO] Неиспользуемых скриптов нет: 11 из 11 либо в npm/CI, либо задокументированы
- Где: `scripts/` — 11 файлов. В `package.json`/`vite.config.ts`/`checks.yml`: `build-worker.mjs` (`pretest`, `build`), `check-migrations.mjs` (CI), `verify-owner-csv.ts`, `import-wger.mjs`/`localize-wger.mjs`/`review-wger.ts` (`catalog:*`), `fetch-pose-test-model.mjs` (`test:e2e:prepare`), `serviceWorkerPlugin.ts` (`vite.config.ts:4`). Ручные, но задокументированы: `audit-exercise-data.ts` (`docs/analytics-and-technique.md:62`), `validate-pose-reference.ts` (`:52`), `copy-apk.mjs` (`README.md:113,168`).
- Почему это важно: внешний отчёт мог назвать их мёртвыми — это неверно; удаление сломает либо CI, либо воспроизводимость аудита данных.
- Как чинить: ничего. Максимум — вынести три ручных скрипта в отдельный раздел README.
- Уверенность: подтверждено чтением + grep.

### 13. [INFO] Дублей-клонов модулей нет: LaidDupModal/Panel, WorkoutFlow/Undo, HistoryFilter/Insights, catalog.ts/catalog-v3.ts — разные слои
- Где/Что (Jaccard по нормализованным строкам, скрипт): `LaidDupModal.tsx` vs `LaidDupPanel.tsx` — 0.09 (59 общих строк из ~324/358, в основном импорты/Modal-обвязка); `WorkoutFlow.ts` vs `WorkoutUndo.ts` — 0.01; `HistoryFilter.ts` vs `HistoryInsights.ts` — 0.02; `src/lib/catalog.ts` vs `src/data/catalog-v3.ts` — 0.02. Ни одна пара `src/**` с ≥40 строк не дала >0.35.
- Что по сути: `LaidDupModal` (`:49`) — окно создания/обновления/нового цикла; `LaidDupPanel` (`:38` `LaidDupCard`, `:21` `LaidStatus`) — карточка программы на экране «Программы». Оба используют общий домен `LaidDupPlan` и `LaidWeekOrderEditor` — это переиспользование, а не дублирование. `WorkoutFlow` — навигация по подходам, `WorkoutUndo` — восстановление удалённого; `HistoryFilter` — отбор/группировка, `HistoryInsights` — рекорды/итоги; `catalog.ts` — фасад над v2+v3, `catalog-v3.ts` — данные.
- Почему плохо: «объединить дубли» здесь означало бы склеить разные ответственности и сломать тесты.
- Как чинить: не трогать. Если нужна экономия — только снять `export` с внутренних типов (№8).
- Уверенность: подтверждено скриптом + чтением фасадов.

### 14. [INFO] Два «мёртвых по сканеру» файла на самом деле живые
- Где: `server/local.ts:1-12` — не импортируется TypeScript-кодом, но это dev-entrypoint: `wrangler.jsonc:3` `"main": "server/local.ts"` (прод — `server/cloud.ts`, `wrangler.production.jsonc:5`). `src/services/appleHealth.worker.ts:1` — не импортируется, но создаётся `new Worker(new URL("../services/appleHealth.worker.ts", import.meta.url), {type:"module"})` в `src/components/AppleHealthPanel.tsx:32`.
- Почему это важно: статический импорт-граф их не видит; удаление сломает локальную разработку Worker'а и импорт Apple Health.
- Как чинить: ничего; при будущем сканировании мёртвого кода — whitelist entrypoint'ов и `new Worker`.
- Уверенность: подтверждено чтением + конфигами.

## Что проверил и НЕ подтвердилось

- **«Домен `TrainingMeetups` используется в App.tsx напрямую через fetch» (L3 внешнего аудита)** — неверно. `src/App.tsx` не импортирует `domain/TrainingMeetups` (grep: 0); он лишь делает `PUT /api/friends/meetups/<id>` из `draft.meetupId` (`src/App.tsx:911-917`). Домен используется тестом `tests/workflow-domain.test.ts:7,76` и type-only импортом `src/domain/FriendsService.ts:1`.
- **`server/local.ts` — мёртвый файл** — нет, dev-entrypoint `wrangler.jsonc:3` (см. №14).
- **`src/services/appleHealth.worker.ts` — мёртвый** — нет, `new Worker(new URL(...))` в `AppleHealthPanel.tsx:32`.
- **LaidDupModal и LaidDupPanel дублируют логику** — нет: 9% общих строк (импорты/Modal), разные слои; общий домен `LaidDupPlan` (см. №13).
- **«Есть неиспользуемые скрипты»** — нет: все 11 либо в npm/CI, либо задокументированы (см. №12).
- **`fallback-snapshots.json` — три одинаковых снапшота/дублирующиеся поля** — нет: три разных релиза, id хэш-зависимые, совпадает только 12 из 38 записей v2↔v3; все три читаются `ExerciseRepository` (см. №11).
- **«Мёртвые экспорты в `src/domain/` и `server/` (валидаторы, типы)»** — нет ни одного экспорта, не используемого даже внутри своего файла; `validExecution` вызывается в `server/validation.ts:151,215`. Реально мёртвых экспортов 20, из них 14 — таблицы `db/schema.ts`, которые нельзя удалять (№8/№9).
- **«Упражнения есть только в v2 и пропадут при удалении v2»** — нет: v2 — действующая база, v3 её только дополняет; уникальны только 5 id **v1** (`facepull`, `lunge`, `legcurl`, `hipthrust`, `calf`), и они нужны лишь для до-v2 записей (№10).
- **«Дубли модулей: WorkoutFlow/WorkoutUndo, HistoryFilter/HistoryInsights, catalog.ts/catalog-v3.ts»** — не подтвердилось измерением: 1–2% общих строк, разные ответственности (№13).
