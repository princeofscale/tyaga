# 04 — Экраны и состояние

> Лог агента аудита «Тяга», 2026-11-24. Пишет только владелец этого файла.
> Формат записи: `[severity] файл:строка — суть → почему это проблема → что делать`.
> Severity: `BLOCKER` / `HIGH` / `MED` / `LOW` / `INFO`.

**Зона ответственности:** `src/App.tsx`, `src/components/**`, `src/features/**` — баги состояния, гонки, утечки, a11y, UX-недоработки

---

## Мысли по ходу (черновик)

- HEAD проверял по факту: cwd `/Users/princeofscale/Desktop/gym`, репозиторий `tyaga-agent-evolution`. `bash` в этой сессии запрещён (запрос отклонён), поэтому все проверки — чтением через read/grep/glob. Отсюда все уверенности «подтверждено чтением», без запусков.
- Skill `modern-web-guidance` загружен, но его CLI-поиск (`npx modern-web-guidance search`) требует bash — выполнить не смог. Применял его чек-лист (нативные `<dialog>`, tablist, aria-live, touch-targets, reduced motion), но guide-id не цитирую, т.к. retrieve не выполнялся.
- Прочитаны целиком/по частям: App.tsx (1663), WorkoutView.tsx (1809), SupplementsScreen.tsx (1079), ProgramsScreen.tsx (1076), FriendsScreen.tsx (1003), HistoryImporter.tsx (942), AppModals.tsx (839), ExerciseLibrary.tsx (729), BodyMap.tsx (645), ProgressScreen.tsx (531), AccountProfileForm.tsx (510), TodayDashboard.tsx (454), AppChrome.tsx (273), LiveRoomProvider.tsx (272), WorkoutGym.tsx (206), HistoryScreen.tsx (215), Modal.tsx, NumberField.tsx, Select.tsx, useDraftTabs.ts + draftTabs.ts + draft.ts, useRestNotifications.ts, usePendingWorkouts.ts, theme.ts, BodyweightContext.tsx, catalog.ts, ExerciseCatalog.ts, parts of Supplements.ts/TrainingProgram.ts.
- Таймеры/интервалы/подписки проверены поголовно (grep setTimeout/setInterval/addEventListener): все интервалы и listeners имеют cleanup, кроме одного setTimeout в App. Это в основном хорошо.
- AbortController: App.load, FriendsScreen, ExerciseLibrary, LiveRoomProvider, PoseVideoAnalysis — есть. Мутации (save/delete/import) идут без signal, но это осознанно (нельзя обрывать PUT).
- Ключевой риск, который вылез при чтении: обработчики, делающие **два update подряд из одного клика** (React batch + объект вместо функции) — см. находку 1. Это же место ломает логику суперсетов.
- Второй системный риск: контракт `Modal.onClose`: чтобы окно осталось открытым, callback обязан вернуть `false`. Там, где вместо этого пишут `if (!busy) setModal(null)`, при Escape во время запроса окно уходит в невидимое «closing», но остаётся модальным → приложение перестаёт принимать клики. Два подтверждённых места (находки 3, 4) и подозрение на TeamChallenges/RecoveryCodeModal (не разобрал до конца, в «не подтвердилось»).
- `key={index}` в переупорядочиваемых/удаляемых списках не нашёл: Reorder в добавках по id, упражнения в редакторе программ по exerciseId, суперсеты по exerciseId-index. Это записал в «не подтвердилось», чтобы не тащить ложное.
- Дубли состояния: `activeDate` в добавках не синхронизируется с полуночью (LOW); `soundEnabled` локальный + глобальный mute — терпимо; `settings`/`settingsDraft` и `mass`/`account.bodyMassKg` защищены (dirty/копия).

## Находки

### 1. [HIGH] Создание суперсета: второй setState из того же клика затирает первый
- Где: `src/components/WorkoutView.tsx:1425-1436` (вызовы `patchExercise` на 1431 и 1433), `src/components/WorkoutView.tsx:637-642` (`patchExercise`), `src/components/WorkoutView.tsx:637` (`setWorkout = (workout) => update({ ...draft, workout })`)
- Что: при включении суперсета у упражнения с индексом `ei > 0` без предыдущего суперсета клик вызывает `patchExercise(ei, ...)`, затем `patchExercise(ei - 1, ...)`. Оба вызова строят новый объект от одного и того же `draft`/`w` из замыкания рендера и вызывают `update(object)` → `setDraft(object)`. React батчит оба обновления, второе заменяет первое.
- Почему плохо: у помеченного упражнения `supersetId` пропадает — в суперсет попадает только предыдущее упражнение. Соединительная плашка (условие `we.supersetId && w.exercises[ei+1]?.supersetId === we.supersetId`, 1595) не появляется, «15 с отдыха» между упражнениями суперсета не применяется (`isSupersetTransition`, 660-664), у предыдущего упражнения остаётся одинокий бейдж «СУПЕРСЕТ». Данные черновика при этом валидны, поэтому сохранение проходит молча — пользователь получает неверную тренировку.
- Как чинить: сделать `patchExercise` функциональным (`setDraft(d => ...)`), либо в этом обработчике собрать один объект: `const next = {...w, exercises: w.exercises.map(...два индекса сразу...)}; setWorkout(next)`.
- Уверенность: подтверждено чтением (React 18+ batching; при отсутствии батчинга результат тот же — замыкание `draft` не обновилось синхронно).

### 2. [HIGH] Правка дозировки добавки: поле пересоздаётся на каждой цифре и теряет фокус
- Где: `src/components/SupplementsScreen.tsx:318-320` (`key={`${item.id}-${doseParts.amount}-${doseParts.unit}`}`), `src/components/SupplementsScreen.tsx:98-103` (`onCommit` на каждый валидный `onChange`), `src/components/SupplementsScreen.tsx:854` (`onUpdate` → `onChange(SupplementsStore.update(...))`)
- Что: `DoseInput` хранит текст локально, но при каждом валидном символе коммитит число в родителя; родитель обновляет `state.stack`, `doseParts.amount` меняется, а key содержит amount → React размонтирует input и смонтирует новый с тем же значением. Фокус и позиция каретки теряются.
- Почему плохо: набрать двузначную дозу («12», «250») в редакторе стека нельзя: после первой цифры фокус уходит, вторая цифра никуда не попадает; остаётся 1. Если пользователь не заметил — сохранится 1 г вместо 10 г. Это основной сценарий формы «настроить добавку».
- Как чинить: убрать `amount/unit` из key (оставить `item.id`), а внешние изменения подхватывать в `useEffect` по `amount/unit` с проверкой «поле не в фокусе / текст не тронут» — как это уже сделано в `NumberField.tsx:31-35`.
- Уверенность: подтверждено чтением.

### 3. [HIGH] Escape/клик по фону во время импорта оставляет невидимое модальное окно и блокирует приложение
- Где: `src/features/modals/AppModals.tsx:483-485` (`onClose={() => { if (!importBusy) setModal(null); }}`), `src/components/Modal.tsx:21-26` (`finish` снимает окно только если callback вернул не `false`), `src/components/Modal.tsx:27-33`, `src/styles/base.css:484-486` (`.modal.closing[open] { animation: modal-out .16s ease-in forwards }`)
- Что: `HistoryImporter` может работать десятки секунд (`onBusy` → `importBusy`). При Escape/backdrop `Modal.requestClose` ставит класс `closing`, по таймеру вызывает `onClose`, тот возвращает `undefined` (не `false`) → `finished.current = true`, родитель не размонтирует окно. Анимация с `forwards` делает dialog прозрачным, но `dialog[open]` остаётся модальным в top layer → документ inert.
- Почему плохо: приложение выглядит пустым/некликабельным, окно закрыть больше нельзя (`requestClose` сразу выходит по `finished.current`), помогает только перезагрузка. Если импорт при этом упадёт, ошибка отрисуется в невидимом окне — пользователь её никогда не увидит.
- Как чинить: `onClose={() => { if (importBusy) return false; setModal(null); }}`; для страховки — в `Modal` при `onClose()` не-`false` всегда вызывать `dialog.close()`, а также сбрасывать `finished` при повторном `requestClose`. Идеально — блокировать Esc/backdrop на время импорта явным пропом.
- Уверенность: подтверждено чтением (CSS-анимация с forwards + контракт Modal).

### 4. [HIGH] Диалог «Удалить программу»: закрытие во время запроса — тот же капкан, но для удаления
- Где: `src/components/ProgramsScreen.tsx:1040-1044` (`onClose={() => { if (!busy) setDeleting(null); }}`), `src/components/ProgramsScreen.tsx:1058-1068` (`busy` на время `props.onDelete`)
- Что: при Escape во время удаления `onClose` возвращает `undefined`, окно уходит в `closing`/невидимое, `deleting` остаётся; `finished` заблокирован. Если удаление упало, `setError(...)` пишется в невидимое окно, а приложение остаётся inert.
- Почему плохо: тот же soft-lock, что и в находке 3; опаснее тем, что операция деструктивная — пользователь не видит, удалилось ли, и не может ни закрыть окно, ни повторить.
- Как чинить: `if (busy) return false;` до `setDeleting(null)`; в остальном — как в находке 3.
- Уверенность: подтверждено чтением.

### 5. [MED] Лишняя запись history на оверлеи: кнопка «Назад» перестаёт выходить из приложения
- Где: `src/App.tsx:641-645` (`history.pushState` при `layered`), `src/App.tsx:646-663` (`closeTop`/`onPop`, `backEntry.current = false` только в `onPop`)
- Что: при открытии любого оверлея пушится запись. Если закрыть оверлей кнопкой (setModal(null), setDetail(null)…), запись в истории остаётся, `backEntry.current` остаётся `true`. Следующее нажатие «Назад» съедает эту запись: `onPop` вызывает `closeTop()` (закрывать нечего) и `setBackPops`, эффект при `!layered` ничего не пушит — визуально ничего не происходит.
- Почему плохо: на Android кнопка «Назад» — основной способ выйти; пользователь жмёт её на главном экране и остаётся в приложении, либо тратит лишнее нажатие. Раздражает и выглядит как зависание навигации.
- Как чинить: при программном закрытии верхнего оверлея вызывать `history.back()` (если `backEntry.current`), либо синхронизировать: когда `layered` стал `false` и `backEntry`, делать `history.back()` и сбрасывать флаг в `onPop`; не пушить новую запись, пока старая не снята.
- Уверенность: подтверждено чтением логики.

### 6. [MED] Любой reload рисует полноэкранный спиннер и выбрасывает пользователя из текущего контекста
- Где: `src/App.tsx:250-254` (`load` сразу `setLoading(true)`), `src/App.tsx:1254-1258` (при `loading` весь контент заменяется на «Загружаем твой журнал…»), вызовы `load()`: `src/App.tsx:381-385` (`tyaga:synced`), `src/features/modals/AppModals.tsx:632-635` (сохранение профиля), `src/App.tsx:1012-1024` (undo импорта)
- Что: `load` не различает первичную загрузку и фоновое обновление. Каждое облачное событие `tyaga:synced`, сохранение профиля или отмена импорта прячет весь экран под спиннером, хотя данные уже есть.
- Почему плохо: на медленной связи (зал, метро) экран мигает «Загружаем журнал…», текущая вкладка/скролл пропадают (контент условно рендерится заново), кнопки недоступны. Пользователь думает, что приложение перезагружается, и может закрыть его.
- Как чинить: ввести `refreshing` отдельно от `loading`; спиннер только если `!workouts.length && !loadError && !offlineData`. Фоновый `load` не должен менять `loading`.
- Уверенность: подтверждено чтением.

### 7. [MED] Редактор программы пересчитывает подсказки весов на каждое нажатие клавиши
- Где: `src/components/ProgramsScreen.tsx:90-93` (`weightHints = useMemo(..., [editor, props.workouts, props.timeZone])`), `src/domain/TrainingProgram.ts:172-184` + `133-147` (`weightHints` → `reference` → `history.filter(...)` + `WorkoutReference.latest` на каждое упражнение)
- Что: `editor` меняется на каждый символ в названии/заметках/числах; `weightHints` заново прогоняет всю историю для каждого из до 30 упражнений. Комментарий на 110 строке («isDeload stays off the keystroke path») защищает только `isDeload`, но `weightHints` остаётся на пути ввода.
- Почему плохо: с ростом истории (сотни тренировок) ввод названия программы на телефоне начинает подтормаживать; при длинных заметках — заметно. Это же значение нужно лишь в свёрнутом `<details>«Ещё»`.
- Как чинить: мемоизировать по «структурной» части (`editor.id`, `editor.revision`, список exerciseId) или считать лениво при раскрытии `details`; вынести расчёт из рендер-цикла редактора.
- Уверенность: подтверждено чтением (сложность видна в TrainingProgram.reference).

### 8. [MED] Две «таблицы вкладок» не следуют паттерну tablist: нет стрелок, roving focus и aria-controls
- Где: `src/components/FriendsScreen.tsx:498-527` (`role="tablist"` + `role="tab"`, все табы в tab-порядке, без `aria-controls`/`id` у панелей), `src/components/SupplementsScreen.tsx:767-798` (`role="tablist"`, панели — `<section>` без `role="tabpanel"`/`aria-labelledby`)
- Что: у Friends табы — кнопки без обработки ArrowLeft/Right/Home/End и без roving `tabIndex`, панели имеют `role="tabpanel"` но не связаны с табами; в добавках панели вообще не помечены `tabpanel`. При этом в проекте уже есть правильный образец: `src/features/progress/ProgressScreen.tsx:217-268` (roving tabIndex + стрелки + Home/End).
- Почему плохо: скринридер объявляет tablist, но ожидаемая клавиатурная модель не работает; Tab прогоняет все табы, стрелки не переключают. Для таб-интерфейса это прямое нарушение APG, которое читалка/клавиатурный пользователь замечает.
- Как чинить: скопировать обработчик из ProgressScreen, добавить `id`/`aria-controls`/`aria-labelledby` панелям (Friends уже частично готов — панели размечены).
- Уверенность: подтверждено чтением.

### 9. [MED] «alertdialog»-подтверждения в профиле — это div без фокуса, Escape и связи с кнопкой
- Где: `src/components/AccountProfileForm.tsx:458-473` (выйти со всех устройств), `src/components/AccountProfileForm.tsx:490-505` (выйти из аккаунта)
- Что: `role="alertdialog"` стоит на `<div>` внутри `<details>`; фокус не переносится в диалог (только `autoFocus` на кнопке отмены — при рендере внутри details это сработает, но при повторном открытии нет), Escape не обрабатывается, `aria-modal` не выставлен, вне диалога контент не inert.
- Почему плохо: клавиатурный/скринридер-пользователь не получает модального контекста: Tab уходит в форму и остальные details, Escape не отменяет, а после клика по «Выйти» без подтверждения может сработать удаление данных. При этом это единственное место выхода из аккаунта — критичный сценарий.
- Как чинить: использовать существующий `Modal` (нативный `<dialog>` уже даёт focus trap/Escape) или добавить обработчик Escape + управление фокусом + `inert` на остальную форму.
- Уверенность: подтверждено чтением.

### 10. [LOW] Строка подхода — кликабельный div без клавиатуры
- Где: `src/components/WorkoutView.tsx:935-940` (`<div ... onClick={() => setActiveSetKey(...)}>`)
- Что: клик по строке раскрывает «быструю правку» подхода; у div нет `role`, `tabIndex`, обработки Enter/Space.
- Почему плохо: клавиатурный пользователь раскрывает быструю правку только через фокус на числовом поле (побочный эффект `fieldProps.onFocus`), а клик по пустому месту строки для него недоступен; скринридер не знает, что строка интерактивна.
- Как чинить: либо перенести `onClick` на кнопку-индикатор/сделать строку `role="group"` без клика, либо добавить `tabIndex={0}`, `role="button"`, `onKeyDown` и `aria-expanded`.
- Уверенность: подтверждено чтением.

### 11. [LOW] setTimeout прогрева чанков без очистки
- Где: `src/App.tsx:223-224` (`else setTimeout(warm, 1500)`)
- Что: таймер не сохраняется и не чистится в cleanup; эффект с `[]`.
- Почему плохо: после размонтирования (выход из аккаунта) таймер вызовет `preload()` четырёх чанков — лишние запросы к сети на экране логина; на медленной связи это конкурирует с загрузкой экрана входа.
- Как чинить: `const id = setTimeout(warm, 1500); return () => clearTimeout(id);` (и для `requestIdleCallback` — `cancelIdleCallback`).
- Уверенность: подтверждено чтением.

### 12. [LOW] «План добавок» не переключается на новый день без перезагрузки
- Где: `src/components/SupplementsScreen.tsx:411` (`const [activeDate, setActiveDate] = useState(today)`)
- Что: `today` приходит пропом и обновляется в App (`localDate(new Date(), ...)` на каждом рендере), но `activeDate` инициализируется один раз и не синхронизируется.
- Почему плохо: если приложение открыто через полночь, экран добавок продолжает показывать вчерашний день («План на 2026-11-23», отметки вчерашнего дня), при этом «сегодня» в шапке может уже смениться — отметки уйдут не в тот день.
- Как чинить: `useEffect(() => setActiveDate(today), [today])` (с сохранением ручного выбора: сбрасывать только если пользователь не ушёл с сегодняшнего дня).
- Уверенность: подтверждено чтением.

### 13. [LOW] Быстрое переключение файлов импорта: побеждает не последний выбранный
- Где: `src/components/HistoryImporter.tsx:95-122` (асинхронный `await file.text()` на 107, затем `setText/setFileName/setFormat`)
- Что: нет отмены/проверки актуальности: если выбрать файл A, затем B, промис A может разрешиться позже и перезаписать состояние; выигрывает последний завершившийся, а не последний выбранный.
- Почему плохо: редкий, но неприятный сценарий: в предпросмотре окажется другой файл, чем показано в подписи, и пользователь импортирует не то. Хотя text/name/format меняются согласованно, ожидание «последний выбор» нарушено.
- Как чинить: хранить счётчик поколений (`const gen = useRef(0)`), сверять после `await`; при несовпадении — игнорировать.
- Уверенность: подтверждено чтением.

### 14. [INFO] Тёмная тема и reduced motion: что реально учтено
- Где: `src/lib/theme.ts:86-109` (только акцентные темы), `src/styles/base.css:6` (`color-scheme: dark`), `src/components/Modal.tsx:29`, 13 CSS-блоков `@media (prefers-reduced-motion: reduce)`, `useReducedMotion` в WorkoutView/ProgramsScreen/FriendsScreen/SupplementsScreen/TodayDashboard/BodyMap
- Что: приложение сознательно только тёмное (светлой темы нет), `prefers-color-scheme` не учитывается — но `color-scheme: dark` выставлен, поэтому нативные контролы не «светлеют». Reduced motion учтён и в JS, и в CSS. `forced-colors: active` есть точечно (base.css:657).
- Почему важно: это не баг, но при аудите «prefers-color-scheme не учтён» нельзя выдавать за находку — это осознанный дизайн; единственное, чего нет, — `prefers-contrast`/`forced-colors` для всех кастомных кнопок.
- Уверенность: подтверждено чтением.

## App.tsx: перегружен ли и что выносить

Да, 1663 строки — всё ещё монолит, хотя от прежних 2824 он уже изрядно похудел. Внутри одного компонента `JournalApp`: **40 `useState`, 19 `useEffect`, 15 `useMemo`, 6 `useRef`, 5 `useCallback`** и ~270 строк JSX-роутера по `view` (1298-1572). Смешаны пять независимых слоёв: загрузка/офлайн, черновик и вкладки, сохранение тренировки, импорт/откат, UI-роутер и модалки. Готовые к выносу куски (по возрастанию риска):

1. `useJournalData()` — `load`/`offlineSnapshot`/`offlineData`/`loadError`/`product`/`stored`/`settings` (127-351). Чистая загрузка, без UI.
2. `useLaidAutoMaxes()` — эффект 439-485 (`laidAutoBusy`, последовательные `saveRoutine`). Отдельный побочный эффект с собственным busy-локом.
3. `useImportState()` — `importUndo/lastImport/lastImportRun/pendingImport/undoAsk/lastNoop` + `undoImport` (227-241, 1008-1033).
4. `useLayeredBack()` — `layered`, `pushState`, `closeTop`, `onPop` (636-663) — вместе с находкой 5.
5. `useSaveWorkout()` — 815-941 (127 строк): самая сложная мутация (проверки, 409, очередь, live room, meetup, тосты). Выносить с тестами.
6. `useDeleteWorkout()` — 963-1006.
7. `useSettingsEditor()` — 1059-1091 (`settingsDraft`, `saveSettings`, `openSettings`).
8. `useTodayPlan()` — вычисления 398-538 (`currentWeek/currentLoads/todaySlots/todayPlan/sources/week*`) — ~140 строк чистой логики.
9. JSX-роутер 1298-1572 → компонент `JournalViews` с пропсами-срезами; тогда `App` остаётся ~300 строк композиции. Заодно `AppModals` (839 строк, 30+ пропсов) стоит разбить по группам: профиль/настройки, импорт/бэкап, тренировка-detail, инструменты.

Что НЕ стоит выносить ради строк: `go`, `start`, `sessionItem`, `exerciseCards` — они завязаны на полтора десятка состояний и при выносе распухнут в пропсы.

## Что проверил и НЕ подтвердилось

- **Черновик с личными упражнениями теряется при перезагрузке** — нет. `exerciseForEntry` → `ExerciseCatalog.forEntry` (src/domain/ExerciseCatalog.ts:59-75) резолвит custom/wger из `entry.externalDefinition`, который `entrySpec` пишет в упражнение (src/lib/catalog.ts:49-63), а `parseDraft` проверяет через `exerciseForEntry` (src/lib/draft.ts:91-97). Даже если упражнение не зарегистрировано в каталоге, снимок в черновике спасает.
- **`key={index}` в переупорядочиваемых/удаляемых списках** — не нашёл: `Reorder.Group` добавок на `item.id` (SupplementsScreen:827-862), упражнения редактора программ на `entry.exerciseId` (ProgramsScreen:688-691), списки истории/друзей/программ на id. `key={i}` встречается только в статических путях SVG (BodyMap:527, ProgressChart:73) и статичных сегментах.
- **Интервалы/подписки без очистки** — не подтвердилось: все 14 `setInterval` и ~40 listener'ов имеют cleanup (проверял по grep addEventListener/removeEventListener, WorkoutView:151/214/305, FriendsScreen:178-187, LiveRoomProvider:122-192, TodayDashboard:47-59, AppChrome:44-56, BodyweightContext:33-61, usePendingWorkouts:50-62, useRestNotifications:73-82). Единственный непокрытый таймер — находка 11.
- **`useEffect` с объектными зависимостями, перезапускающийся каждый рендер** — в основном нет: `useLiveRoom()` мемоизирует value (LiveRoomProvider:267-271), `deloadStore`/`mutationQueue`/`importUndo` — `useMemo`, `setDraft`-обёртки стабильны. `room` в WorkoutView:487 меняется только при реальном обновлении комнаты, не каждый рендер.
- **Гонка «двойной submit» сохранения тренировки** — не подтвердилась: `saveWorkout` проверяет `saving` (App.tsx:816), кнопка `disabled={saving}` (WorkoutView:1183), плюс `guardEdit()` до и после запроса (App.tsx:817, 854, 875) и защита от перезаписи более свежего черновика. Аналогично импорт: кнопка `disabled={busy}` (HistoryImporter:919-921).
- **Вечный спиннер при ошибке сети** — нет: у App есть `loadError` с кнопкой «Повторить» (App.tsx:1245-1252) и офлайн-снапшот; у друзей — error + «Обновить»; у библиотеки — error + «Повторить».
- **`setState` после unmount в FriendsScreen** — закрыто `mounted.current` и `generation` (FriendsScreen:129-161).
- **Тост без aria-live** — нет: `role="status"` на AppChrome:252, WorkoutView:1622 + sr-only polite 1712-1714, FriendsScreen:468.
- **Нет scroll-lock при открытой модалке** — гипотеза, НЕ подтверждена: `Modal` использует нативный `showModal()` (Modal.tsx:13-19), а `body:has(dialog[open]){overflow:hidden}` в стилях отсутствует. Нужен браузерный тест: в Chrome фон под модалкой обычно не скроллится колесом, но на iOS/Safari и при программной прокрутке возможны прокрутки страницы. Без запуска (bash запрещён) утверждать не буду.
- **`exerciseById(exerciseDetail)!.name` роняет приложение для личного упражнения** — не подтвердилось: единственный источник `setExerciseDetail` из прогресса идёт из `AnatomyExplorer`, который перебирает `EXERCISES` (AnatomyExplorer.tsx:277), т.е. только курируемый каталог; остальные вызовы — из `ExerciseLibrary` с уже загруженными карточками.
- **`WorkoutView` теряет правку при быстром вводе из-за LWW** — не подтвердилось: каждый ввод идёт отдельным событием `onChange` с ре-рендером между ними; `update` — object-replace, но замыкание `draft` успевает обновиться. Теряется только явный «двойной update из одного обработчика» (находка 1).

<!-- итог: 14 записей в «Находках», 9 в «не подтвердилось»; см. краткое резюме ведущему -->
