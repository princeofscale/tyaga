# SETUP — независимый QA preflight и план регрессий
## ТЕКУЩИЙ СТАТУС: Завершение QA SETUP контура, фиксация и передача в разработку

Фактический порядок исполнения контура верификации SETUP:
1. Предварительный аудит и строгая проверка статических типов: [own-strict-all-r4-execution.json](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/own-strict-all-r4-execution.json>) (exit code 0) и [own-strict-included-all-r4.log](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/own-strict-included-all-r4.log>) (exit code 0, 4 файла QA включены в проект).
2. Независимое обнаружение e2e-тестов в чистом изолированном корне: [browser-run-discovery-r3/discovery.log](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/browser-run-discovery-r3/discovery.log>) (exit code 0, ровно 16 тестов: 8 desktop + 8 mobile).
3. Полный запуск Playwright на выделенном сервере :8796: [browser-run-baseline-r3/browser-report.json](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/browser-run-baseline-r3/browser-report.json>) (exit code 0, 16 passed / 0 failed / 0 skipped / 0 flaky / 0 errors).
4. Запуск доменных тестов и D1-миграций: [own-node-tests-r4.log](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/own-node-tests-r4.log>) (exit code 0, 10 passed, 98 CLI вызовов: 83 с кодом 0 и 15 ожидаемых отклонений ограничений целостности).
5. Изолированный переносимый клонированный прогон: [own-portable-clone-r1-node.log](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/own-portable-clone-r1-node.log>) (exit code 0, 6 passed, git rev-parse exit code 128 / fatal: not a git repository).
6. Финализация отчёта и чек-суммирование: формирование [own-final-qa-report.md](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/own-final-qa-report.md>) и [own-final-freeze.json](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/qa/setup/own-final-freeze.json>).

Все 18 заявленных скоупов верифицированы согласно собственной матрице (12 SCOPED PASS, 5 PARTIAL, 1 NOT PROVEN); общего безоговорочного PASS на весь продукт нет. Ограничения 5 частичных скоупов (BL-CALENDAR, BL-SYNC, BL-BACKUP, BL-UX, BL-FAIL) и неподтверждённого BL-POSE строго задокументированы.
Семь исходных файлов QA зафиксированы (frozen). Вся последующая часть документа ниже носит исторический характер (stale plans, ранние этапы отладки) и сохранена без изменений.

Новый обязательный запуск `npm test` генерирует свежие уникальные одноразовые фикстуры и локальные состояния миграций `migration-*` через неизменяемый тест миграций, разрешённый после авторизации Lead; эти запуски не публикуются в удалённый/продуктовый SQL, а существующие исторические прогоны сохранены без изменений.

Коррекции QA harness спроектировал QA в разрешённом Lead scope; приложение не менялось.

## Сохранённая R1 execution Note перед R2 (исторический план)

Task3 execution released lead; только own assigned QA paths. Shared source/dist/legacy tests заморожены; исходная explore Note ниже сохранена как история, её BLOCKED/pending строки больше не текущий execution статус. R01 не закрыт, PO gate closed. Ниже зафиксированы собственные наблюдения ПЕРЕД следующим run, не будущий PASS.

- Initial Node run exit1 сохранён; R2 actual Node run exit1: 4 domain PASS + все 5 full Wrangler/D1 matrix PASS, immutable provenance assertion FAIL. R3 targeted immutable run actual exit0/1test; test-name filter исключил 5 matrix cases (runner skipped0). Exact исторический SQL-only delta обеих parent snapshots/current union/runtime = только sync_versions; никакого blanket ignore. Full DDL/owner/sentinel/trigger/replay проверки сохранены.
- Actual discovery-r1 exit0, ровно16 visits/1 own spec (8desktop+8mobile). Actual browser-baseline-r1: exit1,4pass/12fail,0skip/0flaky,320596.938ms. Все failed logs/traces/report сохранены, будущий runTag baseline-r2 не перезапишет r1.
- Independently read r1 lifecycle: exclusive8796 fresh probes; requested teardown143, portfree; frozen producer hashes identical,234 files src/server/drizzle/dist/package.json. Lead journals/configs gate НЕ включает. Нет persistent READY claim.
- R1 own fixture/oracle defects: duration3600 вне server 0..1440 minutes; обязательный MachineRegistry.model.model пуст; duplicate bodyweight shortcut/ToolsHub locator; history detail не открыта перед Edit; range текст вложен в строку упражнений. Коррекции только own spec, не приложение; сами edits не PASS.
- BL-LIVE real HTTP and calculators/invalid-video gate passedboth actual Chromium projects. Invalid-video gate НЕ genuine pose/model inference. Browser registration/profile/logout/login/draft reload/finish + API1800 executed before wrong Edit locator; no full BL-WORK PASS пока повторный сценарий не завершён.
- Следующий шаг: independently reread saved corrections, own discovery-r2, strict same-invocation8796 fresh-preflight/server/real HTTP/desktop+mobile execution/teardown with QA_RUN_TAG=baseline-r2. No npm-test/pretest/build/install while frozen. Final mandatory tsc/npmtest/build engineer after explicit QA filenames freeze, не наследовать прежний256green.

## R2 actual failure и точный план R3 (не PASS)

Actual discovery-r2 exit0,16/1. Actual browser-r2 exit1,stats4pass/5fail/7did-not-run,0flaky,duration420001.022ms; global420s cap/teardown error сохранены. R2 НЕ full16 result. Outer/helper teardown free8796,requested143,234frozen-producer files unchanged. Desktop full registration/profile/logout/login/draft reload/finish/edit1800 и Live успешны; desktop/mobileCAS успешны. R1FAIL иR2FAIL не отменены.

- Исправлен invented Tools exact title на actual App2172 «Инструменты и настройки», не приложение.
- Archive oracle теперь active-only API absence + actual SyncDoc rowactive0/revision3/deletedfalse и retry200. MachineInstance не имеет active field; не превратить archive в physical-delete tombstone. Исторический snapshot и1500/0/ownership/replay assertions сохранены.
- Reversed common9>8 получает real native rangeUnderflow/nonempty validationMessage и неизменённый API routines snapshot; затем отдельный perexercise9>8 должен получить actual custom alert «максимум не меньше минимума» и тот же неизменённый snapshot. Это две реальные negativeветки, не удаление error/численного критерия.
- Own supplementary tsconfig extends root, strict inherited/include ownE2E+PW/exclude[]; actual npx --no-install tsc --noEmit --project exit0 read independently, root tsc excludesQA therefore not substitute. Mechanical runner accidentally wrote NEW strictlog/.exit-code root; Lead notified; originals retained, byte-copies only toQA. Не заявлять perfect process compliance.
- Initial domain/DOM review completed; new all4 strict gate FAILED2/inclusion1 from duplicate suffixes, suffix-only saved repair awaits fresh compiler proof; common max=input.min(repMin) is native rejection, separate perexercise9/8 uses actual domainguard/customalert. Actual machine SQL has compositeownerPK but NO declared model FK; no false FKclaim. Own matrix will additionally execute actual duplicate model/instance PK + DECLARED live-member accountFK negative probes acrossall5 states, exact errors and rows/seq unchanged.
- Saved initial domain and DOM audit, but NEW portable/root/git-free/immutable-manifest/current-original-SHA/expanded-freeze/exclusive-output repairs awaiting own review and fresh strict audit/runtime; no premature PASS.
- Latest finite order: own saved-content/type audit → distinct fresh discovery → full browserR3 16 → fullNode10r4 → approved clone6 → own report/freeze; nopretest/build. Server lifecycle remains sameboundedinvocation. Global browser cap2400000ms covers16×120000+startup, unchanged percase120000/retries0, no hidden skips. PASS only after actual rawlogs/exits/proofs independently read.

## Lead-found portability and harness issues, independent SHA reconciliation, and strict execution order

1. **Harness & Portability Corrections**: Lead identified hardcoded absolute workspace roots, runtime Git subprocess dependency in migration tests, mutable root migration references rather than immutable byte verification, loose Playwright output directory isolation, unmonitored QA test/config inputs in the helper server, and incomplete tsconfig QA inclusions. All migration files are now pinned to static literals with SHA-256 assertions from verified manifest bytes, resolving root via `realpathSync(fileURLToPath(new URL("../", import.meta.url)))` without calling `git`.
2. **SHA Verification & Reconciliation**: Earlier R2 actual 12 hash fields exactly match actual `own-provenance-portability-prep.json` data; no SHA suffix discrepancies or hallucinated table hashes from prior summary tables are used.
3. **Escalation Security Policy**: Denied native bash command attempting disallowed escalation parameter before execution is strictly preserved and documented; alternate or bypass executions are not attempted.
4. **Execution Sequence**: Strict ordering requires:
   - All 4 static targets updated + discovery against a distinct fresh root.
   - Fresh R3 full 16 browser execution with global 2400000ms timeout.
   - Fresh Node (10 cases) execution.
   - Verification report generation and final freeze.
   - Lead approved exact NEW artifacts/agent-evolution/qa/setup/portable-clone-r1/ AFTERmainNode10: exclusivecanonicalparent guard, copiesonly ownmigrationtest/package/drizzle, installeddepsreadonly symlink, childGitceiling+unsetGitvars and actualgitrev-parse exit128 retained, 6actualWrangler tests. Proofonlyotherpath/no discoveredGit/sameinstalleddeps, NOTfreshinstall/crossOS/wholeCI. R1/R2 failures/rootstrays retained.

## Историческая explore Note до release (не текущий verdict)

## Статус и пределы доказательств

**QA execution: BLOCKED** до завершения engineering `task-1` и явного release lead. Это explore Agent Note для `task-3`, не продуктовый раунд, не QA PASS и не закрытие задачи. R01/task-4 остаётся pending после task-3; setup fixes не считаются раундом.

QA самостоятельно прочитал инструкции/docs/configs/source/fixtures; выполнил только read-only pwd/branch/status. Workspace `/Users/princeofscale/Desktop/gym/tyaga-agent-evolution`, branch `agents/tyaga-30-rounds` совпали; напечатанные статусы этих команд — 0. Последний собственный просмотр index ещё показывал unmerged schema/journal/package/lock/snapshot; clean working text не доказывает разрешённый merge. Wrapper bash не показал отдельного exit-code marker: его статус не выдуман.

QA не запускал тесты/typecheck/build/install/download/миграции/Chromium/HTTP/port probes/server; background jobs QA нет, application defects не воспроизведены. Reported npm-ci0, cache, чужая проверка портов и текущий engineering npm-test 1/256 failed/build pending — сведения lead/других агентов, не независимый QA verdict. Memory по новой QA инфраструктуре не нашла карточек; deja по новым QA/config/instrumentation paths не нашёл точного совпадения; historical reports не заменяют текущую проверку.

Только own QA Note, assigned agent-qa tests/configs и QA artifacts входят в write scope. Original Tyaga, чужие source/config/tests/central registries/Git index, remote/production D1, real accounts/secrets/deploy/push/main/APK и DSH вне scope. До release никаких test/source/config edits или execution.

## 1. Read-only config review: текст, не working-runtime PASS

| Источник | Наблюдаемый факт | Доказательство после release |
| --- | --- | --- |
| [Isolated Wrangler](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/wrangler.agent-evolution.jsonc>) | Dedicated DB/local entry/assets+SPA/migrations; после замечания QA lead добавил API run_worker_first, QA перечитал edit. | Actual JSON auth/data/API navigation не SPA HTML, assets/deep links и корректный local DB. Edit не HTTP PASS. |
| [Original baseline config](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/playwright.agent-baseline.config.ts>) | Original suite/single worker/no reuse/no retries; loopback8787 с .wrangler/agent-evolution-e2e, loopback preview5173/strictPort. | Config load/fresh ports/processes/persist, localhost/preview proxy/cookies/Origin и actual Chromium. Full originals исполняет lead, не QA. |
| [Rounds config](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/playwright.agent-rounds.config.ts>) | 8795/webServer undefined; excludes ровно workout/program/friends/together; failure trace/images/no retries. | Это не own QA runtime после task-3 rev2. Own config8796 только agent-qa specs/no inherited servers/cleanup. |
| [TypeScript config](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tsconfig.json#L16>) | Playwright configs/tests вне include. | tsc0 не доказывает config/spec load: отдельный Playwright list, затем real run. |
| [Vite](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/vite.config.ts>) / [local entry](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/server/local.ts>) | Preview proxy ещё не проверен. Local entry forced identity local-development, Origin rewrite только5173. | Product8795 остаётся ЧИСТЫМ для PO: QA НЕ register/save/mutate там. One-profile/platform требует собственного8796/real Worker и разных fixture platforms. |
| [Manifest](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/package.json>) / [Worker builder](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/scripts/build-worker.mjs>) | npm-test/pretest/build пишут shared output. | Никакого overlap engineer/lead builds; API fixtures должны использовать согласованный fresh Worker. |

OutputDir не перенаправляет explicit screenshots. [Design](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/design.spec.ts>), [progress](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/progress.spec.ts>), [daily workflow](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/daily-workflow.spec.ts>), [biomechanics](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/biomechanics.spec.ts>) и [workout](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/workout.spec.ts>) пишут legacy/root artifacts. Lead закрепил full original suite/root writes за собой. Own QA только testInfo.outputPath/QA artifacts; чужое не удалять.

Два real MediaPipe сценария skip без model/photo. [Pinned-fixture script](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/scripts/fetch-pose-test-model.mjs>) QA не запускал. SKIP/blocked scripts/unsupported runtime отдельно, не PASS/security fix.

## 2. Coverage boundaries существующих fixtures

- [Shared fixture](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/fixtures/api.ts>), [device tests](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/device.test.ts>), [sync tests](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/sync.test.ts>): SQL.js/LocalD1/direct API; не public HTTP/browser/IndexedDB durability. Sequential sync не simultaneous apply proof.
- [Основная API fixture](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/api.test.ts#L13-L66>), [live API fixture](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/live-rooms-api.test.ts#L1-L100>): actual Miniflare D1/compiled Worker/dispatchFetch/register/cookies — не SQL.js, но не listener/browser. Legacy-v1 upgrade есть, не branch-layout/filename-ledger доказательство. Большие файлы изучены выбранными участками, не всеми tests.
- [Bodyweight unit fixture](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/bodyweight-journal.test.ts>), [weight UI fixture](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/fixtures/bodyweight.ts>), [live UI fixture](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/fixtures/live.ts>): Map-backed/mock backend/storage; не actual server CAS/Web Locks/D1/owner proof.
- Design/progress/daily/biomechanics используют API mocks. Real MediaPipe тоже mocked preview API; daily append/revision1 не durable update-CAS. Workout/[program](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/tests/e2e/program.spec.ts>) absolute helpers требуют5173/8787; workout real cleanup/import/export. Program целиком не прочитан. BaseURL не перенаправляет Node fetch/absolute expectations.

## 3. Независимый read-only audit инженерной migration instrumentation

Полностью прочитан [instrumentation script](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/setup/verify-migration-tools.mjs#L1-L194>), полностью [results JSON](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/setup/migration-tool-results.json>), [outer exit code](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/setup/migration-tools.exit-code>) и ключевые участки [raw log](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/setup/migration-tools.log>). Поиск markers показал40 exit-code0. Это actual ENGINEER evidence, не исполненные QA tests/PASS.

[Rooms-only invocation](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/setup/migration-tools-wRU4oo/15-rooms-only-merged-migrations.log>) локально применяет только machines; [machines-only invocation](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/artifacts/agent-evolution/setup/migration-tools-wRU4oo/29-machines-only-merged-migrations.log>) только rooms. Отдельные persist paths/configs, local flags и actual Wrangler banners видны в logs. Script seed/merged/replay проверяет filename ledger и sentinels. ORM импортирует реальный sql-js migrator, asserts old timestamp/missing live_members/21tables/11ledger; unsupported machines-only upgrade честно обозначен, не замаскирован rewrite SQL/timestamps.

**Coverage gaps, не application FAIL:**

1. 0009-only отсутствует; empty case имеет NULL sentinels.
2. Count6 trigger names и конечные tombstones после INSERT→UPDATE→DELETE не доказывают каждое INSERT/UPDATE действие отдельно: delete trigger может скрыть отсутствие предыдущего эффекта.
3. Table/index names и foreign_key_check не доказывают column/PK/FK/index/trigger definitions. Expected table list строится из того же combined snapshot, не независимого SQL oracle.
4. Одна setup-owner и raw SQL не доказывают API owner isolation/одинаковые IDs разных владельцев.
5. publishedSqlModified:false и версии частично literals в этом script; immutable hashes/provenance/next-generator нужны отдельно, не выводятся из этих полей.
6. Script привязан к конкретным HEAD/MERGE_HEAD; не переносить его как QA acceptance runner после изменения merge state.

## 4. Собственная migration/storage/sync проверка после release

[Rooms SQL](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/drizzle/0010_live_rooms.sql>) и [machines SQL](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/drizzle/0010_machines.sql>) полностью прочитаны: rooms membership/FK/indexes, compound-owner machines/index/6triggers. Duplicate numeric prefix сам по себе не defect. Published SQL/filenames immutable; hashes/provenance QA ещё не проверил.

[Journal](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/drizzle/meta/_journal.json>), [rooms header](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/drizzle/meta/0010_snapshot.json#L1-L5>), [combined header](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/drizzle/meta/0011_snapshot.json#L1-L5>), [combined sections](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/drizzle/meta/0011_snapshot.json#L638-L835>) и [schema tail](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/db/schema.ts#L268-L312>) показывают обе исторические tags/parent chain/3tables. Full union/hashes/generator ещё не QA доказаны. [Engineering plan](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/docs/agent-evolution/setup-engineering.md>) не заменяет QA.

Own matrix: **fresh / 0009-only / rooms-only / machines-only / already-combined+replay**, новые отличимые sentinel workouts/settings/accounts/catalog/history и разные owners. Actual local Wrangler filename ledger в own disposable QA DB/persist/scratch migrations; SQL.js/device filename ledger separately. После upgrade: independently expected tables/full DDL/index uniqueness/PK/FK/foreign_key_check, immutable payload/IDs/versions/archived state, six bodies плюс state after EACH insert/update/delete, correct owner/tombstone/seq, повторный upgrade no new sync events. Не использовать engineer probe/stand DB для independent tests.

Machines-only timestamp-ORM skip — observed engineer evidence/unsupported workflow, не собственный FAIL; primary supported Wrangler upgrade всё равно проверить. Next-generation read-only или QA scratch copy: IDs/parents/contiguous journal/historical tags/exact union/no destructive no-change generation. Published SQL не менять.

- [Device backend](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/device/localBackend.ts>) fully read: filename ledger/per-migration transaction/IndexedDB/serialized API/persist before response/FK restored. [LocalD1](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/device/LocalD1.ts>) transactional batch/undefined rejected/boolean normalized; это код, не browser durability proof.
- [Cloud sync](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/device/cloudSync.ts>)/[SyncService](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/server/SyncService.ts>): workout timestamp/doc/tombstone/capability/owner cursor/account-token guards. Pagination/filter/replay/delete/switch нужны; competing applies reading before batch/duplicates/equal-fractional timestamps — неисполненные hypotheses, не FAIL.
- [BodyweightJournal](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/services/BodyweightJournal.ts>) fully read: ОТДЕЛЬНЫЙ revision/CAS/tombstone outbox/stable mutation/cache+queue/binding/short locks/explicit conflict/ack newer pending. [Weight API](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/services/BodyweightApi.ts>)/[ApiClient](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/services/ApiClient.ts>) pin credentials/timeout/nonJSON/auth expiry. Offline/reload/retry/lost response/quota/corrupt/two-tabs/rebind/logout/no mixing, cloud401 not local expiry.
- [ImportService](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/src/services/ImportService.ts>) all-package dryRun перед sequential writes; [BackupImportService](</Users/princeofscale/Desktop/gym/tyaga-agent-evolution/server/BackupImportService.ts>) разные atomic boundaries. Не whole-import transaction. Invalid later package/no initial writes/interruption/retry/stable idMap/no duplicate/real export/legacyv1–v5 обязательны.

## 5. Baseline matrix — все runtime cases сейчас BLOCKED

Локальные QA case IDs, не product requirement registry. Сейчас actual actions только source/instrumentation review. После release каждому PASS/FAIL/BLOCKED/PARTIAL с exact actions/results/repro/evidence; fixtures и live layers раздельно.

| ID | Сценарий/oracle/evidence |
| --- | --- |
| BL-ENV | Own config load/Chromium/8796 real API JSON+browser API navigation/SPA/assets; exact processes/ports/DB/persist/browser/response/trace. |
| BL-MIG | 5 upgrade states/replay/hashes/next-generator/6triggers/full PK-FK-index DDL/sentinels; disposable SQL.js И actual local D1. |
| BL-OWN | A/B/outsider/same machineID/workout/settings/routine/custom/favorites/weight/sync/privacy; actual HTTP/Worker/D1 identities. Trusted fixture headers не production ingress security proof. |
| BL-AUTH | Register/login/wrong/logout/relogin/reload; aria-label/title Мой профиль, сразу Имя/Вес тела, кг/Часовой пояс; exact Сохранить профиль/Профиль сохранён/Выйти из аккаунта; actual HTTP+revision desktop/mobile/keyboard. |
| BL-WORK | Sets add/edit/delete/reorder/weight/reps/RIR/warmup/done/notes; save→navigation→reload→reopen/repeat/stable IDs; real saved JSON/revision/no append duplicates. |
| BL-CAS | Competing workout/settings/routine/stale409/lost response/retry/delete not resurrect; real request forwarding+visible draft/error/reload. |
| BL-MACHINE | Registry create/edit/archive/CAS/immutable model-nickname/side-ROM-drop-superset; 3×50×10=1500 machine/zero free contribution; actual API/UI/backup/history unchanged. |
| BL-MATH | Hand-counted done working3×60×10=1800; exclude unchecked/warmup/future/corrupt/duplicate/deleted; latest revision/separate free-machine/load modes/implements/laterality; domain fixtures+real progress. |
| BL-CALENDAR | Empty/single/max/decimal/timezone/day-week-30d/DST/leap/future/immutable mass-catalog-analysis; controlled clock+browser timezone+reload/export. |
| BL-PROGRAM | Create/save/start/reorder/repeat/history/alternatives; Today/Programs/Progress/Tools/state preservation; real API/UI/reload/neighboring drafts, originals lead. |
| BL-WEIGHT | Offline/edit/delete/reload/retry/stable mutation/replay/two-tabs409 explicit local-server/quota/corrupt/binding; real storage/locks/revision/pending/error/no mixing. |
| BL-SYNC | Push/pull/replay0/tombstones/capability/filter-page cursor/competing versions/token switch; own phone-cloud API/cursor. Unavailable actual device/cloud continuity separately PARTIAL. |
| BL-BACKUP | Actual download parse/legacyv1–v5/custom-machine-routine-favorites-weight/mappings/dryRun/reject/interrupt/retry; real before-after/no duplicates/owner. |
| BL-LIVE | Create/share/join/invalid/leave/expiry/done summary privacy/delayed snapshot/context; real multi-owner Worker/D1+UI, fixtures отдельно. |
| BL-TOOLS | Warmup/plates/bar/small-max-decimal/timer/audio-haptic controls/deload/e1RM/landmarks/alternatives; hand math+desktop/mobile, headless не hardware proof. |
| BL-POSE | Pinned video-joints/empty-unsupported-cancel-errors/no upload/confidence/no medical claims/close-reopen; actual Chromium-MediaPipe/network или explicit SKIP. |
| BL-UX | Desktop1440×1080/mobile touch/long notes/no overflow-overlap/focus/Escape-Tab-Enter/modal restore/reduced motion/repeated save-back-reload; QA images+DOM/errors/mocks labelled. |
| BL-FAIL | Offline/timeout/nonJSON/400-401-409-500/interrupted save-import-model/draft retained/visible retry/no silent success; real endpoint или controlled failure injection+request/UI/storage. |

## 6. Safe execution protocol после explicit release (НЕ выполнен)

1. Lead завершает exclusive engineering/task1, подтверждает actual config/build/release. QA get+claim ready task3/current revision, fresh diff/conflicts, no overlapping writers/builds. Порт проверять непосредственно перед launch, не полагаться на historical lsof.
2. Product8795/.wrangler/agent-evolution не мутировать. Own local-only Wrangler config под QA artifacts: main real server/index.ts, existing dist/client assets/run_worker_first API, unique local DB ID, .wrangler/agent-evolution-qa; loopback127.0.0.1:8796 only. Managed job ID записать/отслеживать/собрать output; не default/replacement product server.
3. Own Playwright config под QA artifacts включает ТОЛЬКО agent-qa*.spec.ts, baseURL8796, explicit testDir, no inherited webServer/default cleanup/root screenshots; output/testInfo.outputPath под QA artifacts. После release actual --list, затем desktop/mobile Chromium. Repo tsc не проверяет configs/tests; --list не runtime PASS. Actual installed invocation сверить, no npx auto-install.
4. Fixture trusted identity headers через API/Playwright extraHTTPHeaders дают собственные accounts/platforms без source/auth changes. Это actual local HTTP/Worker/D1/API, НЕ production header-security proof. Own login/profile/add-edit-done/save-reload/navigation/programs/progress/tools/machines/live/sync/backup по матрице; no success API fulfilment mocks.
5. Own migration/test edits после assignment/release: memory/deja/current source/fixtures/command first. Scratch generation/DB только QA scope; no rewrite published SQL. Shared npm-test/pretest/build только согласованно, не параллельно engineer/lead output.
6. Full original5173/8787/.wrangler/agent-evolution-e2e/no reuse и root images — lead-owned. QA independently reviews transferred actual logs/results/trace/skips; чужой run не объявлять собственным.
7. Actual commands/exit/process/browser/images/trace/API/storage evidence под QA artifacts; oracle→status, no retry masking, fix→same case+neighboring regression same SETUP/round. Unknown/incomplete BLOCKED/PARTIAL.
8. Future round полностью original round-XX-user-requirements; ROUND N — QA REPORT requirementID→PASS/FAIL/BLOCKED/PARTIAL/exact actions/results/evidence/repro/defects и regressions отдельно. Engineer claim не QA, QA не PO acceptance; только lead закрывает round.

## 7. Instrumentation limitation и handoff

Native QA draft-write calls ошибочно сериализовались с запрещёнными escalation-полями и вернули `Error: invalid justification: expected a non-empty sentence` до файловой операции. Это validation error, НЕ filesystem denial или разрешение widening. Read-only bash также ошибочно содержал escalation field; scope не расширялась, lead уведомлён. Никаких approval/bypass/DSH config edits. Lead явно разрешил обычный agy utility writer только точного собственного Note; utility не выполняет проверки и не создаёт QA results. QA после записи должен independently read/verify этот Note.

Статический preflight и план переданы lead. Runtime verdict BLOCKED/PASS нет; task3 pending/blocked, не claimed/completed. Следующее действие — explicit execution release/ready task и собственный isolated8796. До этого no tests/builds/servers/source/config changes. Сам факт сохранения Note не закрывает integration или раунд.
