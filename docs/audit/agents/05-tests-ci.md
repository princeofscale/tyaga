# 05 — Тесты, CI и репозиторий

> Лог агента аудита «Тяга», 2026-11-24. Пишет только владелец этого файла.
> Формат записи: `[severity] файл:строка — суть → почему это проблема → что делать`.
> Severity: `BLOCKER` / `HIGH` / `MED` / `LOW` / `INFO`.

**Зона ответственности:** `tests/**`, `.github/**`, конфиги сборки, `docs/**`, `.env.device`, гигиена репозитория, открытые PR

---

## Мысли по ходу (черновик)

1. Репозиторий — **git worktree**: `.git` это файл `gitdir: /Users/princeofscale/Desktop/gym/tyaga/.git/worktrees/tyaga-agent-evolution`. Поэтому все команды запускал из `tyaga-agent-evolution`, а не из `tyaga`; HEAD `aef5f82`, ветка `main`, worktree чист (в `git status` только `?? .codex/` и `?? docs/audit/`).
2. `tests/`: **67** файлов `*.test.ts`, прогон `npm test` → **544 теста, все pass, 86,6 с**. Из них 12 файлов с именами раундов = **181 тест** (~33 %).
3. Локально прогнал ровно то, что делает static-job CI: `check:migrations` OK (15 файлов), `tsc --noEmit` OK, `tsc -p tsconfig.test.json --noEmit` OK, `eslint . --max-warnings=0` OK. То есть статическая часть CI на HEAD зелёная (локальный Node 24.21.0 совпадает с `node-version: "24"`).
4. E2E: 31 spec, 56 вызовов `waitForTimeout` c суммарным сном **76 066 мс**, **631** локатор по CSS-классам (`.session-item`, `.toast`, `.set-row`…), **137** `getByText`, и на весь `src/` **один** `data-testid` (`ProgramsScreen.tsx:725`).
5. Playwright: visual-режим действительно включается переменной (`playwright.config.ts:3,8,11,14,26,50` + `package.json:18`). Но массива `projects` в конфиге **нет вообще**, как и `retries`/`reporter`/trace.
6. `.env.device` **в git** при `.gitignore:6` = `.env.*`. Внутри одна переменная `VITE_CLOUD_URL` (адрес воркера, не секрет), но правило игнорирования нарушено и файл отслеживается.
7. `.codex`: правила `.gitignore:19-24` с негативами не гасят каталог — `git status --untracked-files=all` показывает **74** файла (18 `agents/`, 32 `prompts/`, 24 `skills/`), поэтому `?? .codex/` висит постоянно.
8. Проверил подозрение «тесты не трогают настоящую БД»: `tests/fixtures/api.ts:6-15` поднимает sql.js, выполняет **все** `drizzle/*.sql` и вызывает `handleApi` — серверные тесты интеграционные, миф не подтвердился.
9. `SyncService` покрыт 4 файлами (`changes/apply/recovery`), `LiveRoomService` — 7 тестами (create/join/push/leave). Тезис «не покрыто» из брифа **не подтвердился**.
10. Скачивание модели для e2e (`scripts/fetch-pose-test-model.mjs`) идёт с sha256-проверкой — «качаем без контрольной суммы» не подтвердилось, но сеть в CI всё равно точка отказа.
11. E2E сам не запускал (нужен build + wrangler + vite preview, ~10+ минут и запись в `.wrangler/e2e`); flaky-оценка — по чтению кода, это помечено в записях.
12. Нашёл главный провал гейта: `tsconfig.test.json:6` покрывает только `tests/e2e`, а `tests/*.test.ts` (67 файлов) не типизируются нигде — доказал через `tsc --listFiles` (0 совпадений). Там же — 4 ссылки на удалённые `playwright.*.config.ts`.
13. `docs/linting.md:14` утверждает, что типы тестов проверяются `typecheck:tests` — по факту только e2e; README:145 говорит аккуратнее, но тоже не предупреждает, что юниты не проверяются.

---

## Находки

### 1. [HIGH] CI не сохраняет артефакты e2e — падение нечем расследовать
- Где: `.github/workflows/checks.yml:33-46`, `playwright.config.ts:5-51`
- Что: job `e2e` делает `build → playwright install → test:e2e` и всё; `actions/upload-artifact` нет. В конфиге нет `retries`, `reporter`, `use.trace`, `use.video`, `use.screenshot` — значит при падении нет ни HTML-отчёта, ни trace, ни видео, ни скриншота.
- Почему плохо: 31 spec запускается ~10-20 минут на общем окружении; любое падение видно только как «красный job». Разработчик не может отличить флак от регрессии, e2e перестаёт быть гейтом и его начинают игнорировать.
- Как чинить: добавить в конфиг `reporter: process.env.CI ? [["html", {open:"never"}],["github"]] : "list"`, `use: { trace: "retain-on-failure", video: "retain-on-failure", screenshot: "only-on-failure" }`, `retries: process.env.CI ? 1 : 0`; в CI — `- uses: actions/upload-artifact@v4` с `if: failure()`, пути `playwright-report/`, `test-results/`.
- Уверенность: подтверждено чтением

### 2. [HIGH] 631 e2e-локатор привязан к CSS-классам, на весь `src` один `data-testid`
- Где: `tests/e2e/*.spec.ts` (все), примеры: `multi-tab-draft-and-signout.spec.ts`, `live-room-edits-and-swap-filters.spec.ts`; частоты: `.session-item` 53, `.import-undo` 18, `.laid-status` 17, `.toast` 16, `.pending-banner` 15, `.set-row` 14
- Что: селекторы строятся на именах CSS-классов (`locator(".session-item")`) и на видимом тексте (`getByText` — 137 раз, `toBeVisible()` — 435). Во всём `src/` ровно **один** `data-testid` — `src/components/ProgramsScreen.tsx:725` (`laid-editor-note`), и его используют только 3 строки в одном спеке (`laid-dup-program.spec.ts:537-545`); CSS-селекторов по атрибутам (`locator("[data-…]")`) нет ни одного.
- Почему плохо: HEAD `aef5f82` — «чистка репозитория, консолидация CSS»; любое переименование класса в `src/styles/*.css` ломает e2e молча (типы не проверяют строки селекторов). Половина тестов проверяет вёрстку глазами пользователя через текст, поэтому смена копирайта = красный e2e.
- Как чинить: ввести `data-testid` (`data-test="session-item"`) на 10-15 ключевых контейнеров и перевести `locator(".<class>")` на `getByTestId`; текстовые `getByText` оставить только там, где текст и есть требование (сейчас таких — `Профиль сохранён`, `Выйти из аккаунта`), остальные заменить на роли/тест-иды.
- Уверенность: подтверждено чтением (grep-статистика по 31 spec)

### 3. [MED] Локальный e2e не воспроизводит CI: общая накопительная D1 и переиспользование сервера
- Где: `playwright.config.ts:36-48` (`reuseExistingServer: !process.env.CI`, миграции без сброса, `--persist-to .wrangler/e2e`), `tests/e2e/workout.spec.ts:18-21,101-110`, `tests/e2e/program.spec.ts`
- Что: 29 из 31 spec полностью браузерные (API замокан через `page.route`/`round01Fixture`); в настоящий воркер/D1 ходят только `workout.spec.ts` (20 обращений к `APIRequestContext`) и `program.spec.ts` (2). Им webServer накатывает миграции в `.wrangler/e2e` и не очищает её: локально каталог живёт с 14 ноября (`.wrangler/e2e/v3/`), а `reuseExistingServer` подхватывает уже запущенный воркер с накопленными аккаунтами. Тесты подстраиваются под состояние (`workout.spec.ts:114`: `state.registered ? "login" : "register"`), `cleanup(request)` чистит только данные своего аккаунта.
- Почему плохо: два spec ведут себя по-разному до и после первого прогона, и локальный результат не равен CI-результату с чистой базой; отладка «почему в CI иначе» упирается в это.
- Как чинить: в webServer добавить `rm -rf .wrangler/e2e` перед `migrations apply` (или `--persist-to .wrangler/e2e-$CI_RUN`); отдельный `npm run test:e2e:reset` для локального режима.
- Уверенность: подтверждено чтением (grep по 31 spec + `ls .wrangler/e2e`)

### 4. [MED] 56 `waitForTimeout` — 76 секунд сна в каждом полном прогоне
- Где: `tests/e2e/multi-tab-draft-and-signout.spec.ts:128,151,171,414,880,926,1018,1035,1069,1071,1098,1127,1129,1140,1177,1180,1225` (17), `live-room-edits-and-swap-filters.spec.ts:80,397,411,441,447,480,519,549,586,597,642,673,680` (13), `visual-extra.spec.ts` (6), `touch-targets-and-program-plan.spec.ts` (5), `together.spec.ts:104,210,224,235` (4), `calculators-deload-recovery.spec.ts` (4), `supplements-and-coach.spec.ts:77,83`, `laid-auto-maxes.spec.ts:47,58`, `redesign-suite.spec.ts:120`, `import-history-and-overview.spec.ts:351`, `offline-and-set-prefill.spec.ts:559`
- Что: сумма номеров = 76 066 мс; 7 вызовов по 6 000 мс (`live-room…:519,549,586,597`, `together.spec.ts:104`, `multi-tab…:880`), 11 ≥ 1 500 мс. Один вызов `waitForTimeout(16)` (`multi-tab…:1177`) — «подождать кадр».
- Почему плохо: фиксированный сон не ждёт события; на медленном CI его не хватает (флак), на быстром — тратит время (76 с из ~10 минут прогона). `16` мс не гарантируют и одного кадра — это худший вариант.
- Как чинить: заменить на `await expect(locator).toHaveText(...)` / `toHaveAttribute` / `page.waitForFunction(...)` по наблюдаемому признаку (в live-комнатах — по тексту веса, в мультитабе — по содержимому localStorage `tyaga_draft`); `16` → `page.evaluate(() => new Promise(r => requestAnimationFrame(r)))`.
- Уверенность: подтверждено чтением (grep), оценка влияния — гипотеза

### 5. [MED] Имена тестов по раундам вместо поведения: 181 из 544 тестов в 12 `round-*` файлах
- Где: `tests/round-01.test.ts` … `tests/round-11.test.ts`, `tests/round-11-signout.test.ts`
- Что: файлов по раундам — 12; тестов в них: R01 15, R02 8, R03 15, R04 10, R05 16, R06 6, R07 8, R08 6, R09 21, R10 36, R11 36, R11-signout 4 (всего 181). Названия блоков внутри — `"R01-REQ04: …"`, `"QA-R06-13: …"`: номер требования/QA-прогона, а не поведение. 54 остальных файла названы по поведению (`deload.test.ts`, `offline-mutation-queue.test.ts`…).
- Почему плохо: имя файла не отвечает на вопрос «куда добавить тест на это поведение»; одно поведение уже размазано по 3-4 файлам (`«Подставить 85 %»` в round-04/06/07; offline-очередь — в round-03 и `offline-mutation-queue.test.ts`; склонения — round-01/07/10). При удалении раунда из документации (в HEAD раунды закрыты) файлы остаются археологией.
- Как чинить: раскладка по поведению ниже (п. 6). Прецедент уже есть — `round-11-signout.test.ts` вынесен из `round-11.test.ts` по теме; `npm test` — glob `tests/*.test.ts`, поэтому подпапки потребуют правки скрипта (`package.json:15`).
- Уверенность: подтверждено чтением

### 6. [MED] `round-10`/`round-11` перегружены и смешивают слои — предложение разбиения
- Где: `tests/round-10.test.ts` (788 строк, 36 тестов), `tests/round-11.test.ts` (434 строки, 36 тестов), `tests/round-05.test.ts` (474/16), `tests/round-03.test.ts` (318/15)
- Что: в `round-10` лежат рядом схема периодизации Лейда (22-175), старт/недели/вес (230-336), оценка 1ПМ и «можно обновить максимум» (356-423), валидация периодизации на сервере + `sync/apply` 400 (423-575, 612, 727), блины (575-587). В `round-11` — владение черновиком между вкладками (12-110, 195-288, 426), вес из плана (309-330), перенос цикла при восстановлении (342-371), статусы недели 10 (379-395), поиск упражнений-синонимов (403-418).
- Почему плохо: файл на 788 строк с 5 доменами невозможно ревьюить; падение в конце файла читается как «сломался Лейд», хотя сломался расчёт блинов.
- Как чинить: маппинг (новые имена → блоки, которые переносятся как есть):
  ```
  tests/domain/set-propagation.test.ts        ← round-01:21-66,119-151 (R01-REQ04,D2,D3)
  tests/domain/plural-forms.test.ts           ← round-01:84; round-07:27,116; round-10:689
  tests/domain/exercise-search.test.ts        ← round-02:84,96; round-03:93; round-04:214,226; round-11:403-418
  tests/domain/set-prefill-and-rir.test.ts    ← round-02:37; round-03:43,182
  tests/domain/program-weight-source.test.ts  ← round-02:117; round-03:76
  tests/device/offline-snapshot.test.ts       ← round-03:112,289,306
  tests/device/offline-queue-account.test.ts  ← round-03:236,260,273
  tests/account/signout-clears-data.test.ts   ← round-03:199 + весь round-11-signout.test.ts
  tests/domain/deload-application.test.ts     ← round-04:95,135; round-06:13,22,31; round-07:83,121
  tests/import/strong-file.test.ts            ← round-05:32,90,110,331,381,423
  tests/import/history-filter.test.ts         ← round-05:118,144,163,179,293,411
  tests/import/my-exercises-marking.test.ts   ← round-05:229,432,464
  tests/domain/exercise-swap.test.ts          ← round-08:11-66 (6 тестов)
  tests/domain/live-room-total.test.ts        ← round-09:18-113
  tests/domain/draft-tab-ownership.test.ts    ← round-09:290,299; round-11:12-110,195-288,426
  tests/domain/laid-dup-program.test.ts       ← round-10:22-175
  tests/domain/laid-week-execution.test.ts    ← round-10:230-336
  tests/domain/laid-maxes-update.test.ts      ← round-10:356-423
  tests/server/periodization-validation.test.ts ← round-10:423-575,612,727
  tests/domain/plate-application.test.ts      ← round-10:575,587
  tests/import/cycle-transfer-notice.test.ts  ← round-11:342-371
  tests/domain/laid-week-status.test.ts       ← round-11:379-395
  ```
  Механически: `git mv` + перенос блоков, затем `package.json:15` → `tsx --test "tests/**/*.test.ts"`; иначе новые подпапки не попадут в прогон.
- Уверенность: подтверждено чтением (имена и границы блоков из grep)

### 7. [MED] Покрытие: 8 модулей не имеют ни одного прямого теста
- Где: `src/services/{ApiClient…}` не трогаю — ниже список без прямых ссылок из `tests/`; `src/lib/webmcp.ts` (135 строк), `src/lib/shareLink.ts` (24), `src/lib/liveFinished.ts`, `src/lib/liveRoomContext.ts`, `src/lib/useDraftTabs.ts`, `src/lib/useLiveBroadcast.ts`, `src/services/ProductService.ts` (46), `src/services/{FriendsApi,BodyweightApi,LiveRoomApi}.ts`, `server/{AccountService,ImportReceiptService,FriendsRepository,ExerciseRepository,MachineRepository,MeetupRepository,SharedProgramRepository,ChallengeRepository,BodyweightRepository}.ts`
- Что: проверка — для каждого файла искал упоминание имени модуля в `tests/**/*.ts`; перечисленные не встречаются ни разу. Поведение части из них всё же проверяется на уровне HTTP (`tests/fixtures/api.ts` → `handleApi`) или в e2e — это не «нет покрытия», а «нет юнит-уровня».
- Почему плохо: у `webmcp.ts` (регистрация «инструментов тренировки» в странице) и `shareLink.ts` (Web Share API в `TogetherCard`/`RoomBadge`) нет ни юнита, ни e2e — ветка `navigator.share` не выполняется нигде, ошибка шаринга дойдёт до пользователя.
- Как чинить: `tests/lib/share-link.test.ts` (подменить `navigator.share`/clipboard, проверить fallback и текст), `tests/lib/webmcp.test.ts` (регистрация/снятие инструментов, ответ на неизвестный вызов); API-обёртки — по одному тесту на маппинг ошибок в `ApiError`.
- Уверенность: подтверждено чтением (grep по `tests/`)

### 8. [MED] Visual-режим не в CI и ничего не сравнивает
- Где: `playwright.config.ts:3,8,11,14,26-34,50`, `package.json:18`, `.github/workflows/checks.yml` (нет `test:e2e:visual`)
- Что: флаг `TYAGA_PLAYWRIGHT_MODE=visual` действительно переключает baseURL на 5686, таймаут 90 с, TZ `Europe/Saratov`, отдельный webServer `vite preview --port 5686`, outputDir `test-results/visual`; `design.spec.ts`/`visual-extra.spec.ts` полностью мокают API (`page.route("**/api/**")`). Но в CI этот режим не запускается ни разу, а `toHaveScreenshot`/`toMatchSnapshot` в репозитории **0 совпадений** — скриншоты только складываются в `artifacts/design` для глазами-посмотреть.
- Почему плохо: визуальная регрессия «дизайн Iron/Steel» не ловится автоматически; режим сломается незаметно (например, при переименовании `artifacts`), т.к. его никто не прогоняет.
- Как чинить: либо добавить job `visual` (build → `npm run test:e2e:visual` → upload-artifact), либо honest-комментарий в конфиге «manual only»; для настоящей регрессии — `expect(page).toHaveScreenshot()` на 3-5 стабильных экранах с `maxDiffPixelRatio`.
- Уверенность: подтверждено чтением

### 9. [MED] Playwright-конфиг после слияния трёх конфигов: нет `projects`, режим задаётся мутирующей env
- Где: `playwright.config.ts:5-51`
- Что: `projects` отсутствует — один неявный проект (`browserName: "chromium"` в `use`), поэтому нельзя параллельно/одной командой прогнать app- и visual-наборы; выбор режима — внешняя переменная `TYAGA_PLAYWRIGHT_MODE`, читаемая один раз при загрузке конфига. `testDir: "./tests/e2e"` захватывает все 31 spec. Если запустить `TYAGA_PLAYWRIGHT_MODE=visual npx playwright test` (без списка файлов), весь набор пойдёт против `vite preview` без API-сервера — 29 из 31 spec упадут не по делу.
- Почему плохо: неверный флаг даёт 29 «падений», а не внятную ошибку; отсутствие `projects` мешает завести smoke/visual/offline как отдельные наборы.
- Как чинить: два проекта (`app` — `testIgnore: /(design|visual-extra)\.spec/`, `visual` — `testMatch`), общий `webServer` в массиве, флаг оставить только как выбор проекта; `testIgnore` для visual-спеков в app-проекте.
- Уверенность: подтверждено чтением

### 10. [MED] CI: нет `concurrency`, `timeout-minutes`, actions не прибиты к SHA
- Где: `.github/workflows/checks.yml:1-8,10-14,34-41,48-59`
- Что: триггеры `push: main` + `pull_request`; `permissions: contents: read` (хорошо); `concurrency` нет — каждый новый коммит в PR запускает новый прогон, старый продолжает жечь раннеры. `timeout-minutes` нет ни у одного job (по умолчанию 360 мин; зависший e2e держит раннер 6 часов). `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-java@v4`, `android-actions/setup-android@v3` — теги, не SHA.
- Почему плохо: очередь CI на 4 job × `npm ci` за каждый пуш; при компрометации тега action получает доступ к репозиторию (пусть и с `contents: read`).
- Как чинить: `concurrency: {group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true}`; `timeout-minutes: 20` (static/tests), `40` (e2e), `30` (android); пины `@<sha> # v4.x.y` + Dependabot для actions.
- Уверенность: подтверждено чтением

### 11. [MED] e2e в CI завязан на два сетевых скачивания с storage.googleapis.com
- Где: `package.json:29`, `scripts/fetch-pose-test-model.mjs:4-5,8-12,14-19`, `.github/workflows/checks.yml:45`
- Что: `test:e2e:prepare` скачивает `pose_landmarker_lite_v1.task` (60 с таймаут) и `pose.jpg` (30 с) при каждом прогоне; sha256 **проверяется** (сильная сторона), кэша нет. Файлы кладутся в `artifacts/models/` (в `.gitignore:10`).
- Почему плохо: недоступность GCS или rate-limit = красный e2e без единого изменения в коде; в закрытом/офлайн-окружении CI не запустится вообще.
- Как чинить: `actions/cache` на `artifacts/models` с ключом по sha256, либо положить оба файла в артефакты релиза; при провале скачивания — `test.skip` только для pose-спеки, а не падение job.
- Уверенность: подтверждено чтением

### 12. [MED] Android-job: лицензии SDK не логируются, но пакеты ставятся через `sdkmanager`
- Где: `.github/workflows/checks.yml:60-68`, `android/variables.gradle:2-4`
- Что: `android-actions/setup-android@v3` с `log-accepted-android-sdk-licenses: "false"`, следом `sdkmanager "platforms;android-36" "build-tools;36.0.0"`; проект требует `compileSdkVersion = 36`/`targetSdkVersion = 36` (minSdk 24). Если образ не содержит android-36 с уже принятыми лицензиями, `sdkmanager` упрётся в `--licenses`.
- Почему плохо: job `android` — единственная проверка Capacitor-сборки; его падение блокирует релиз APK и выглядит как «сломался код», а не как настройка окружения.
- Как чинить: поставить `log-accepted-android-sdk-licenses: "true"` (или отдельный шаг `yes | sdkmanager --licenses`), зафиксировать нужные пакеты в `setup-android`.
- Уверенность: гипотеза (по документации action; в CI не проверял)

### 13. [MED] Dependabot: мажоры mediapipe/typescript не отсечены, groups только minor/patch
- Где: `.github/dependabot.yml:1-29`, `package.json:39` (`"@mediapipe/tasks-vision": "0.10.35"` — точный пин), `package.json:65` (`"typescript": "^5.9.2"`)
- Что: секции `ignore` нет вообще; группы `dev-dependencies`/`minor-and-patch` покрывают только `minor`+`patch`, поэтому каждый мажор приходит отдельным PR (лимит `open-pull-requests-limit: 5` на npm и `3` на `github-actions`); авто-мержа нет; `groups` для `github-actions` нет. PR 17/18 (по данным ведущего) падают на мажорах — конфиг их не предотвращает.
- Почему плохо: мажор `typescript`/`@mediapipe/tasks-vision` требует миграции (у mediapipe точный пин — API сменится), PR висит красным, лимит 5 съедают мусорные PR, полезные (patch) перестают приходить.
- Как чинить: добавить
  ```yaml
  ignore:
    - dependency-name: "@mediapipe/tasks-vision"
      update-types: ["version-update:semver-major"]
    - dependency-name: "typescript"
      update-types: ["version-update:semver-major"]
  ```
  плюс `groups: {github-actions: {patterns: ["*"]}}` и `schedule.interval: "weekly"` уже есть.
- Уверенность: подтверждено чтением конфига; статус PR 17/18 не проверял (нет доступа)

### 14. [MED] `.env.device` закоммичен при правиле `.env.*`
- Где: `.env.device:1-3` (отслеживается: `git ls-files` → `.env.device`), `.gitignore:5-8`
- Что: в файле комментарий + `VITE_CLOUD_URL=<адрес воркера>`. Правило `.gitignore:6` (`.env.*`) файл матчит — это видно только с `--no-index`, потому что Git прячет отслеживаемые пути: `git check-ignore --no-index -v .env.device` → `.gitignore:6:.env.*`, а `git ls-files -i -c --exclude-standard` → `.env.device` (единственный такой файл в репозитории). Значение не секрет: `VITE_*` инлайнится в клиентский бандл (`src/device/cloudSync.ts:8`), т.е. и так публично.
- Почему плохо: правило `.env.*` в репозитории не работает, и первый же настоящий секрет (токен, ключ) попадёт в git по той же привычке; файл ещё и расходится у каждого разработчика, создавая шум в diff.
- Как чинить: `git rm --cached .env.device`, добавить в `.gitignore` явное `.env.device`, завести `.env.device.example` с пустым `VITE_CLOUD_URL` и строкой в README; значение для `build:android` брать из CI-секрета/локального файла.
- Уверенность: подтверждено чтением + `git ls-files`/`git check-ignore`

### 15. [MED] `.gitignore` не гасит `.codex/` — 74 untracked файла в каждом `git status`
- Где: `.gitignore:19-24`
- Что: `.codex/*` игнорирует только первый уровень, а `!.codex/agents/**`, `!.codex/skills/**`, `!.codex/prompts/**` возвращают деревья обратно; итог — `git status --untracked-files=all` печатает 74 файла (18 `agents/`, 32 `prompts/`, 24 `skills/`) и `?? .codex/` висит всегда.
- Почему плохо: постоянный грязный `git status` приучает к `git add -A`, и служебные промпты/скиллы агентов уедут в репозиторий (а среди них бывают внутренние инструкции).
- Как чинить: заменить на `.codex/` одной строкой (или `.codex/**`), негативы оставить только если каталог действительно нужен в git; сейчас ни один файл `.codex` не отслеживается — значит негативы не нужны.
- Уверенность: подтверждено чтением + `git status`

### 16. [MED] `docs/maintenance-2026-11-19.md` описывает удалённый lint-baseline
- Где: `docs/maintenance-2026-11-19.md:39,40,49`
- Что: документ обещает `scripts/lint-baseline.mjs` + `.lint-baseline.json` («113 существующих находок…»), `npm run lint:report`, `npm run lint:update-baseline`. В HEAD: `scripts/` такого файла не содержит, `.lint-baseline.json` отсутствует, в `package.json` только `lint` (`package.json:19`), а `docs/linting.md:3` прямо говорит «работает без baseline».
- Почему плохо: два документа противоречат друг другу, и оба выглядят актуальными; человек, следуя maintenance-документу, получает `Missing script`/ENOENT и делает вывод «репозиторий сломан».
- Как чинить: пометить `docs/maintenance-2026-11-19.md` как исторический (`> Архив: механизм baseline удалён в aef5f82`) или удалить строки 39-49; в `docs/linting.md` оставить единственный источник истины.
- Уверенность: подтверждено чтением

### 17. [MED] `AGENTS.md` §1: структура каталогов устарела относительно HEAD
- Где: `AGENTS.md:34,35` (и весь блок 10-39)
- Что: строка 35 — `src/styles.css` «Дизайн-система на CSS-токенах»; реально каталог `src/styles/` из 13 файлов (`tokens.css`, `base.css`, `layout.css`, `screens.css`, `workout.css`, `programs.css`, `progress.css`, `friends.css`, `together.css`, `supplements.css`, `auth.css`, `fonts.css`, `layers.css`). Строка 34 — `src/services/ # ApiClient, ProductService, Sync`: `Sync` там нет (модуль переехал в `src/device/cloudSync.ts`), в каталоге 12 файлов. Не упомянуты `src/features/`, `src/hooks/`, `src/device/`, `src/state/`, `src/styles/`.
- Почему плохо: AGENTS.md читают агенты перед правками; отправка «в `src/styles.css`» или «в `src/services/Sync.ts`» ведёт в несуществующие файлы (и половина дизайн-системы остаётся невидимой).
- Как чинить: заменить 34-35 на `src/styles/ (13 CSS-файлов: tokens, base, layout, screens…)` и `src/services/ (ApiClient, ProductService, FriendsApi, LiveRoomApi…), src/device/ (cloudSync, LocalD1)`, добавить `features/`, `hooks/`, `state/`.
- Уверенность: подтверждено чтением (`ls src/styles`, `ls src/services`, `find src -iname '*sync*'`)

### 18. [LOW] `AGENTS.md:46` ссылается на устаревший диапазон строк e2e
- Где: `AGENTS.md:46`, `tests/e2e/workout.spec.ts:112-139`
- Что: «Тест проверяет сценарий входа, редактирования профиля и выхода (строки 120–135)» — сегодня сценарий занимает 112-139 (регистрация/логин 112-123, профиль 124-129, выход 130-131, повторный вход 132-134, cookie 135-137).
- Почему плохо: ссылка на строки в быстро меняющемся файле гниёт; агент ищет требование не там.
- Как чинить: заменить «строки 120–135» на «тест `account registration or login, profile, logout…`», без номеров строк.
- Уверенность: подтверждено чтением

### 19. [LOW] `playwright.config.ts:17` ссылается на несуществующий `offline-pwa.spec.ts`
- Где: `playwright.config.ts:17-18`
- Что: комментарий «Сервис-воркер включается только в сценарии офлайна (offline-pwa.spec.ts)»; такого файла нет. SW действительно разрешают точечно: `tests/e2e/offline-and-set-prefill.spec.ts:273,342` — `test.use({ serviceWorkers: "allow" })`.
- Почему плохо: мёртвая ссылка в единственном месте, объясняющем политику SW; следующий агент будет искать файл и «чинить» не то.
- Как чинить: заменить имя файла на `offline-and-set-prefill.spec.ts`.
- Уверенность: подтверждено чтением (`ls tests/e2e`, grep `serviceWorkers`)

### 20. [LOW] `docs/design-iron.md:4` ссылается на `styles.css` и `round-*.css`
- Где: `docs/design-iron.md:4`
- Что: «перекрывает `styles.css` и `round-*.css`» — ни `src/styles.css`, ни `round-*.css` в дереве нет; есть `src/styles/*.css` и `src/styles/layers.css`.
- Почему плохо: документ о дизайн-системе описывает несуществующие файлы, по нему нельзя понять, куда добавлять правила.
- Как чинить: переписать на `src/styles/` (+ `layers.css` как порядок слоёв).
- Уверенность: подтверждено чтением

### 21. [INFO] `vite preview` в e2e держится на неявном наследовании `server.proxy`
- Где: `vite.config.ts:45` (только `server.proxy`), `playwright.config.ts:44`, `node_modules/vite/dist/node/chunks/dep-3O3b9SCF.js:48553`
- Что: e2e поднимает `vite preview` на 5173 без `preview.proxy` в конфиге; проксирование `/api` → `127.0.0.1:8787` работает только потому, что Vite по умолчанию копирует `server.proxy` в preview (`proxy: preview?.proxy ?? server.proxy`). В коде проекта это нигде не сказано.
- Почему плохо: стоит кому-то добавить `preview: {}`-блок или поменять путь прокси — e2e начнёт отдавать `index.html` вместо `/api`, а ошибка будет выглядеть как «сервер вернул HTML».
- Как чинить: явно продублировать `preview: { proxy: { "/api": "http://127.0.0.1:8787" } }` (не меняя поведение) или комментарием в `vite.config.ts` зафиксировать зависимость.
- Уверенность: подтверждено чтением исходников Vite + конфига

### 22. [INFO] Положительное: серверные тесты — настоящая интеграция, набор зелёный
- Где: `tests/fixtures/api.ts:6-15`, `tests/migration-integrity.test.ts:27-40`, `package.json:15,28`
- Что: фикстура поднимает sql.js, выполняет все `drizzle/*.sql` по порядку и вызывает `handleApi` (реальный роутер воркера) с подменённым `D1Database`; `migration-integrity` сверяет миграции с `drizzle-kit`-схемой и хешами. `npm test`: **544/544 pass, 86,6 с**. `npm run lint`, `npx tsc --noEmit`, `tsc -p tsconfig.test.json`, `npm run check:migrations` — exit 0.
- Почему важно: качество серверных тестов выше, чем следует из названий файлов; опасаться «тесты не видят SQL» не нужно.
- Как чинить: ничего; использовать как аргумент, чтобы не переписывать эту часть.
- Уверенность: подтверждено запуском

### 23. [HIGH] 67 файлов модульных тестов не проверяются типами нигде
- Где: `tsconfig.json:16`, `tsconfig.test.json:6`, `package.json:13-14`, `.github/workflows/checks.yml:20-21`
- Что: корневой `tsconfig` включает `["src","server","db","vite.config.ts","drizzle.config.ts"]` — тестов нет. `tsconfig.test.json` включает `["tests/e2e", playwright-конфиги]` — только e2e. Проверено запуском: `npx tsc -p tsconfig.test.json --noEmit --listFiles` даёт 36 файлов из `tests/`, среди них **0** файлов `tests/*.test.ts`. То есть 67 файлов на ~12 000 строк (`tests/*.test.ts`) не типизируются ни в CI, ни локально; `tsx --test` типы только стирает.
- Почему плохо: тест может собирать объект неверной формы, обращаться к переименованному полю или звать удалённый экспорт — CI зелёный, а падение/ложный «pass» вылезет позже. При `strict: true` это единственный слой, которого нет.
- Как чинить: добавить `"tests"` в `include` `tsconfig.test.json` (e2e и юниты совместимы: и там и там нужны `node` + `@cloudflare/workers-types`), прогнать `npm run typecheck:tests` и починить всплывшие ошибки; в README:145 и docs/linting.md:14 убрать формулировку, из-за которой кажется, что тесты уже покрыты.
- Уверенность: подтверждено запуском (`tsc --listFiles`)

### 24. [LOW] `tsconfig.test.json` ссылается на 4 удалённых Playwright-конфига
- Где: `tsconfig.test.json:6`
- Что: `include` перечисляет `playwright.visual.config.ts`, `playwright.agent-baseline.config.ts`, `playwright.agent-product.config.ts`, `playwright.agent-rounds.config.ts`; в дереве остался только `playwright.config.ts` (проверено `glob playwright*.ts`). `tsc` молча игнорирует несовпавшие шаблоны, поэтому `typecheck:tests` зелёный.
- Почему плохо: следы слияния трёх конфигов остались в конфиге типов; если появится новый конфиг, его забудут добавить, а старые имена создают ложное впечатление, что наборы ещё раздельные.
- Как чинить: `"include": ["tests", "playwright.config.ts"]` (см. п. 23) — и мёртвые имена исчезнут сами.
- Уверенность: подтверждено чтением + `glob`

### 25. [MED] Инструкция «как смотреть визуально» ссылается на удалённый `playwright.visual.config.ts`
- Где: `docs/design-iron.md:55-63`, `docs/design-steel.md:28-36`
- Что: оба документа велят запускать `npx playwright test -c playwright.visual.config.ts tests/e2e/design.spec.ts tests/e2e/visual-extra.spec.ts`. Такого конфига нет (остался только `playwright.config.ts`); режим теперь задаётся `TYAGA_PLAYWRIGHT_MODE=visual` в скрипте `package.json:18` (`npm run test:e2e:visual`). Дополнительно `design-iron.md:62` обещает кадры в `artifacts/design-iron/`, а спеки пишут в `artifacts/design` (`design.spec.ts:17`) и `artifacts/design-quiet` (`visual-extra.spec.ts:13`) — эти же пути верно указаны в `design-steel.md:36`.
- Почему плохо: документированный способ посмотреть дизайн падает с «config not found»; человек делает вывод, что визуальный набор сломан, и перестаёт им пользоваться (он и так не в CI, см. п. 8).
- Как чинить: заменить на `npm run test:e2e:visual` (с предварительным `npm run build`), путь кадров в `design-iron.md` — на `artifacts/design/` и `artifacts/design-quiet/`.
- Уверенность: подтверждено чтением (`glob playwright*.ts`, `package.json:18`, шапки спек)

### 26. [LOW] Числа сценариев Playwright в доках устарели, один maintenance-документ ссылается на несуществующий spec
- Где: `docs/product-v1.5.md:74` («15 сценариев»), `docs/verification-1.5.md:4,29` («15»), `docs/review-response.md:21` («7 Playwright сценариев»), `docs/maintenance-2026-11-22.md:72` (`round-10.spec.ts`)
- Что: фактически в `tests/e2e` — **31** файл `*.spec.ts` (grep/glob). Файла `round-10.spec.ts` в дереве нет (`glob tests/e2e/round-*.spec.ts` → пусто), соответствующее поведение живёт в `laid-dup-program.spec.ts`.
- Почему плохо: по числам в доках нельзя оценить стоимость прогона (15 против 31 — вдвое), а `-g R10-REQ02` по несуществующему файлу в maintenance-записи выглядит как рабочий рецепт.
- Как чинить: числа заменить на «весь набор (`npm run test:e2e`, сейчас 31 spec)» либо не указывать количество; `round-10.spec.ts` → `laid-dup-program.spec.ts`; старые датированные записи (`verification.md:4,58,103`) можно оставить как историю, но пометить дату явно.
- Уверенность: подтверждено чтением + `glob`

---

## Что проверил и НЕ подтвердилось

1. **«SyncService покрыт только одним cross-account тестом»** — нет: `tests/import-sync-recovery.test.ts:55-74` (два сервиса, recovery чужого владельца), `tests/migration-integrity.test.ts:201`, `tests/machines-execution-api.test.ts:234`, `tests/training-calendar.test.ts:162-163` (`changes` → `apply` между устройствами).
2. **«LiveRoomService не покрыт»** — `tests/live-rooms-api.test.ts` содержит 7 тестов, включая `create/join/push/leave`, лимит шести мест, истечение комнат и коллизию кодов.
3. **«Offline-очередь не покрыта»** — домен покрыт: `tests/offline-mutation-queue.test.ts:15-52` (коалесинг ключей, FIFO, сеть vs 409) и `tests/round-03.test.ts:236-273` (привязка к аккаунту, переживание перезагрузки, «только сеть и 5xx повторяем»). Непокрыта интеграция с `ApiClient`/`handleApi`, не сам класс.
4. **«Миграции на реальной БД не проверяются»** — проверяются: `tests/migration-integrity.test.ts` применяет все `drizzle/*.sql` к настоящему SQLite (sql.js) и сверяет со схемой drizzle-kit; `tests/fixtures/api.ts` делает то же для каждого API-теста. Не хватает только запуска через `wrangler d1` (специфика D1), но не SQL-семантики.
5. **«Импорт CSV/HTML не покрыт»** — покрыт: `tests/import-mapping.test.ts`, `import-chunked.test.ts`, `import-undo.test.ts`, `import-replace-api.test.ts`, `round-05.test.ts:32-464` (годовой Strong-файл, «Мои», отмена, восстановление).
6. **«Rate limiting не покрыт»** — частично покрыт: `tests/account.test.ts:69-111` проверяет 429 на `/api/auth/login` и `/api/auth/register` (включая «не запирать смену пароля»). Отдельного лимитера на импорт/синк в тестах нет, но и в брифе его не было.
7. **«Модель для e2e качается без контроля целостности»** — нет, sha256 обеих загрузок проверяется (`scripts/fetch-pose-test-model.mjs:6,14-17`), при несовпадении — throw.
8. **«Visual-режим не включается флагом»** — включается: `playwright.config.ts:3` читает `TYAGA_PLAYWRIGHT_MODE`, `package.json:18` его выставляет; в visual-режиме webServer — только `vite preview` на 5686, что корректно, т.к. оба visual-спека полностью мокают API (`design.spec.ts:50`, `visual-extra.spec.ts:36`).
9. **«`serviceWorkers: "block"` мешает офлайн-тестам»** — нет, спеки точечно ставят `allow` (`offline-and-set-prefill.spec.ts:273,342`); неверен только комментарий (см. п. 19).
10. **«В CI нет проверки миграций/линта»** — есть: `checks.yml:18-19` (`check:migrations`, `lint`), плюс оба typecheck и `build`; локально всё зелёное.
11. **«`.DS_Store`/`dist`/`test-results` попали в git»** — не попали: они в `.gitignore:11-15` и отсутствуют в `git ls-files`; это локальный мусор (включая 40+ старых `.wrangler/agent-evolution-*` каталогов), но не закоммиченный.
12. **«Сессии и логаут не покрыты»** — покрыты: `tests/round-11-signout.test.ts:14-39` (401 = успешный выход, 200 → очистка, 5xx и офлайн — данные не трогаются), `tests/round-03.test.ts:199,289,306` (выход стирает личное, истёкшая сессия стирает кэши журнала/импорта/офлайн-копию, но не черновик и очередь), плюс e2e `multi-tab-draft-and-signout.spec.ts` и `workout.spec.ts:112-139` (cookie `tyaga_session` httpOnly/SameSite, после выхода — «Снова в зале»).
13. **«E2E гоняет настоящий сервер для всех сценариев»** — нет: только 2 spec из 31 (`workout.spec.ts`, `program.spec.ts`); остальные изолированы моками, поэтому порядок запуска почти ни на что не влияет (см. п. 3 — риск сузился до двух файлов).
