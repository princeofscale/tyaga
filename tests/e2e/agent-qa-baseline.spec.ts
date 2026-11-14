import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { makeWorkout, DEFAULT_SETTINGS } from '../../src/lib/model';
import { MachineRegistry } from '../../src/domain/MachineRegistry';
import { TrainingVolume } from '../../src/domain/TrainingVolume';
import type { Workout, MachineInstance } from '../../src/lib/types';
import type { AccountProfile } from '../../src/lib/account';
import { WorkoutImport } from '../../src/domain/WorkoutImport';
import type { SyncDoc } from '../../server/SyncService';
import type { WeightDocument } from '../../src/domain/BodyweightDocument';
const base = 'http://127.0.0.1:8796';
const password = 'Disposable-QA-8796-passphrase';
async function proof(name: string, value: unknown) {
  await test.info().attach(name, { body: Buffer.from(JSON.stringify(value, null, 2)), contentType: 'application/json' });
}
async function http<T>(context: BrowserContext, path: string, method = 'GET', data?: unknown, status = 200, extra: Record<string, string> = {}): Promise<T> {
  const response = await context.request.fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...extra }, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  expect(response.status(), `${method} ${path}: ${text}`).toBe(status);
  const body = JSON.parse(text) as T;
  await proof(`${method}-${path.replaceAll('/', '_')}-${randomUUID()}`, { method, path, status: response.status(), body });
  return body;
}
async function fixture(context: BrowserContext, prefix: string) {
  const id = `qa-8796-${prefix}-${randomUUID()}`;
  await context.setExtraHTTPHeaders({ 'oai-authenticated-user-id': id });
  const email = id + '@example.test';
  const response = await context.request.post(base + '/api/auth/register', { headers: { Origin: base, 'Content-Type': 'application/json' }, data: { email, password, displayName: prefix, timeZone: 'UTC' } });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json() as { profile: AccountProfile };
  await proof('fixture-profile', { id, profile: body.profile });
  return { id, email, profile: body.profile };
}
function workout(name: string): Workout {
  const w = makeWorkout(['bench']);
  w.name = name; w.date = '2026-11-08'; w.createdAt = '2026-11-08T10:00:00Z'; w.duration = 60;
  w.exercises[0].sets.forEach(s => { s.weight = 60; s.reps = 10; s.done = true; });
  return w;
}
async function home(page: Page) { await page.goto(base); await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible(); }
async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth }));
  await proof('actual-chromium-dimensions', dimensions);
  expect(Math.max(dimensions.document, dimensions.body)).toBeLessThanOrEqual(dimensions.viewport + 1);
}
async function tools(page: Page, name: string) {
  await page.getByRole('button', { name: /^Инструменты/ }).first().click();
  await page.getByRole('dialog', { name: 'Инструменты и настройки', exact: true }).getByRole('button', { name: new RegExp(name) }).click();
}

test('BL-ENV BL-AUTH BL-OWN BL-CAS BL-FAIL real HTTP/platform sessions/settings/workout racing CAS and tombstones', async ({ browser, context, page }) => {
  const a = await fixture(context, 'owner-a');
  const b = await browser.newContext();
  const anon = await browser.newContext({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'qa-unsigned-' + randomUUID() } });
  try {
    await fixture(b, 'owner-b');
    const root = await context.request.get(base); expect(root.status()).toBe(200); expect(root.headers()['content-type']).toContain('text/html');
    await http(anon, '/api/settings', 'GET', undefined, 401);
    const cookie = (await context.cookies(base)).map(c => `${c.name}=${c.value}`).join('; ');
    await http(b, '/api/data', 'GET', undefined, 401, { Cookie: cookie });
    await http(context, '/api/settings', 'PUT', { ...DEFAULT_SETTINGS, revision: 0 }, 403, { Origin: 'https://evil.example' });
    const initial = await http<{ settings: typeof DEFAULT_SETTINGS & { revision: number } }>(context, '/api/data');
    const settings = { ...initial.settings, restSeconds: 103 };
    const changed = await http<{ settings: typeof settings }>(context, '/api/settings', 'PUT', settings);
    expect(changed.settings.revision).toBe(1);
    await http(context, '/api/settings', 'PUT', { ...settings, restSeconds: 104 }, 409);
    const w = workout('QA CAS sentinel');
    const saved = await http<{ workout: Workout }>(context, '/api/workouts', 'PUT', w); expect(saved.workout.revision).toBe(1);
    const retry = await http<{ workout: Workout }>(context, '/api/workouts', 'PUT', w); expect(retry.workout.revision).toBe(1);
    await http(b, '/api/workouts', 'PUT', w, 403);
    expect((await http<{ workouts: Workout[] }>(b, '/api/data')).workouts).toEqual([]);
    const races = await Promise.all(['QA left', 'QA right'].map(name => context.request.put(base + '/api/workouts', { headers: { Origin: base, 'Content-Type': 'application/json' }, data: { ...saved.workout, name } })));
    const statuses = races.map(r => r.status()).sort(); expect(statuses).toEqual([200, 409]);
    await proof('actual-CAS-race', { statuses, responses: await Promise.all(races.map(r => r.json())) });
    const current = (await http<{ workouts: Workout[] }>(context, '/api/data')).workouts[0]; expect(current.revision).toBe(2);
    await http(context, '/api/workouts/' + w.id, 'DELETE', { revision: 1 }, 409);
    await http(context, '/api/workouts/' + w.id, 'DELETE', { revision: 2 });
    await http(context, '/api/workouts', 'PUT', current, 409);
    const changes = await http<{ docs: SyncDoc[], cursor: number }>(context, '/api/sync/changes?since=0');
    expect(changes.docs.some(d => d.kind === 'workout' && d.id === w.id && d.deleted)).toBe(true);
    expect(changes.cursor).toBeGreaterThan(0);
    await http(context, '/api/workouts', 'PUT', { ...workout('invalid'), date: '2026-02-30' }, 400);
    expect((await http<{ workouts: Workout[] }>(context, '/api/data')).workouts).toEqual([]);
    await home(page); await noOverflow(page); await page.screenshot({ path: test.info().outputPath('actual-home.png'), fullPage: true });
    await proof('browser-version-and-owner', { version: browser.version(), project: test.info().project.name, owner: a.id, now: new Date().toISOString() });
  } finally { await b.close(); await anon.close(); }
});

test('BL-WEIGHT BL-OWN bodyweight real HTTP account binding/CAS/retry/tombstone/invalid dates', async ({ browser, context, page }) => {
  const a = await fixture(context, 'weight-a'); const b = await browser.newContext();
  try {
    await fixture(b, 'weight-b');
    const accountId = (await http<{ accountId: string }>(context, '/api/bodyweight')).accountId;
    expect(accountId).toBe(a.profile.id);
    const key = 'weight:2026-11-08';
    const input = { accountId, revision: 0, mutationId: randomUUID(), value: { id: randomUUID(), date: '2026-11-08', weightKg: 75.3, note: 'QA sentinel', createdAt: 1794132000000 } };
    const saved = await http<{ document: WeightDocument }>(context, '/api/bodyweight/' + key, 'PUT', input); expect(saved.document.revision).toBe(1);
    expect((await http<{ document: WeightDocument }>(context, '/api/bodyweight/' + key, 'PUT', input)).document).toEqual(saved.document);
    await http(context, '/api/bodyweight/' + key, 'PUT', { ...input, mutationId: randomUUID(), value: { ...input.value, weightKg: 76 } }, 409);
    await http(context, '/api/bodyweight/' + key, 'PUT', { ...input, accountId: 'wrong-account' }, 401);
    await http(context, '/api/bodyweight/weight:2026-02-30', 'PUT', { ...input, value: { ...input.value, date: '2026-02-30' } }, 400);
    await http(context, '/api/bodyweight/weight:2099-01-01', 'PUT', { ...input, value: { ...input.value, date: '2099-01-01' } }, 400);
    const removed = await http<{ document: WeightDocument }>(context, '/api/bodyweight/' + key, 'PUT', { accountId, revision: 1, mutationId: randomUUID(), value: null });
    expect(removed.document.revision).toBe(2); expect(removed.document.value).toBeNull();
    await http(context, '/api/bodyweight/' + key, 'PUT', input, 409);
    expect((await http<{ documents: WeightDocument[] }>(b, '/api/bodyweight')).documents).toEqual([]);
    await home(page); await tools(page, 'Вес тела и тренд'); await expect(page.getByRole('dialog')).toBeVisible(); await noOverflow(page);
  } finally { await b.close(); }
});

test('BL-MACHINE BL-MATH BL-SYNC BL-OWN real HTTP snapshots/archive and capability/replay isolation', async ({ browser, context, page }) => {
  await fixture(context, 'machine-a'); const b = await browser.newContext();
  try {
    await fixture(b, 'machine-b');
    const m = MachineRegistry.create(); m.nickname = 'QA original'; m.model.model = 'QA selectorized station';
    const saved = await http<{ machine: MachineInstance }>(context, '/api/machines', 'PUT', m); expect(saved.machine.revision).toBe(1);
    expect((await http<{ machine: MachineInstance }>(context, '/api/machines', 'PUT', m)).machine.revision).toBe(1);
    expect((await http<{ machines: MachineInstance[] }>(b, '/api/product')).machines).toEqual([]);
    const w = makeWorkout(['row']); w.name = 'QA machine 1500'; w.date = '2026-11-08'; w.createdAt = '2026-11-08T10:00:00Z'; w.duration = 60;
    w.exercises[0].machineInstanceId = m.id; w.exercises[0].machineSnapshot = saved.machine;
    w.exercises[0].sets.forEach(s => { s.weight = 50; s.reps = 10; s.done = true; });
    await http(context, '/api/workouts', 'PUT', w);
    await http(b, '/api/workouts', 'PUT', { ...w, id: randomUUID() }, 400);
    const renamed = await http<{ machine: MachineInstance }>(context, '/api/machines', 'PUT', { ...saved.machine, nickname: 'QA renamed' }); expect(renamed.machine.revision).toBe(2);
    await http(context, '/api/machines', 'PUT', { ...saved.machine, nickname: 'QA stale' }, 409);
    const history = (await http<{ workouts: Workout[] }>(context, '/api/data')).workouts;
    expect(history[0].exercises[0].machineSnapshot?.nickname).toBe('QA original');
    expect(TrainingVolume.summarize(history).total).toBe(0); expect(TrainingVolume.machines(history).find(x => x.machineId === m.id)?.volume).toBe(1500);
    const capable = await http<{ docs: SyncDoc[], cursor: number }>(context, '/api/sync/changes?since=0&capabilities=machines-v1');
    expect(capable.docs.some(d => d.kind === 'machine' && d.id === m.id)).toBe(true);
    const legacy = await http<{ docs: SyncDoc[], cursor: number }>(context, '/api/sync/changes?since=0'); expect(legacy.docs.some(d => d.kind === 'machine' || d.kind === 'machine_model')).toBe(false); expect(legacy.cursor).toBe(capable.cursor);
    const replay = await http<{ applied: number, skipped: number }>(context, '/api/sync/apply', 'POST', { docs: capable.docs }); expect(replay.applied).toBe(0); expect(replay.skipped).toBe(capable.docs.length);
    const bChanges = await http<{ docs: SyncDoc[] }>(b, '/api/sync/changes?since=0&capabilities=machines-v1'); expect(JSON.stringify(bChanges)).not.toContain(m.id);
    await http(context, '/api/machines/' + m.id, 'DELETE', { revision: 2 });
    const archived = (await http<{ machines: MachineInstance[] }>(context, '/api/product')).machines.find(x => x.id === m.id); expect(archived).toBeUndefined();
    const archivedDoc = (await http<{ docs: SyncDoc[] }>(context, '/api/sync/changes?since=0&capabilities=machines-v1')).docs.find(d => d.kind === 'machine' && d.id === m.id); expect(archivedDoc?.deleted).toBe(false); expect(archivedDoc?.row?.active).toBe(0); expect(archivedDoc?.row?.revision).toBe(3);
    await http(context, '/api/machines/' + m.id, 'DELETE', { revision: 2 });
    expect((await http<{ workouts: Workout[] }>(context, '/api/data')).workouts[0].exercises[0].machineSnapshot?.nickname).toBe('QA original');
    await home(page); await tools(page, 'Мои тренажёры'); await expect(page.getByRole('dialog')).toBeVisible(); await noOverflow(page);
  } finally { await b.close(); }
});

test('BL-LIVE BL-OWN real HTTP room join/state/privacy/outsider/leave', async ({ browser, context, page }) => {
  const a = await fixture(context, 'live-a'); const b = await browser.newContext(); const c = await browser.newContext();
  try {
    const ownerB = await fixture(b, 'live-b'); await fixture(c, 'live-outsider');
    const created = await http<{ room: { code: string } }>(context, '/api/friends/live', 'POST', {}); expect(created.room.code).toMatch(/^[A-Z0-9]{5}$/);
    const code = ' ' + created.room.code.slice(0, 2).toLowerCase() + '-' + created.room.code.slice(2) + ' ';
    await http(b, '/api/friends/live/join', 'POST', { code });
    const state = { phase: 'lifting', exercise: 'Жим штанги лёжа', setsDone: 2, setsTotal: 3, tonnageKg: 1200, lastSet: { kg: 60, reps: 10 }, restEndsAt: null };
    await http(context, '/api/friends/live/state', 'PUT', { ...state, privateNote: 'QA SECRET NOT PUBLISHED' });
    const view = await http<{ room: { members: { displayName: string, state: unknown }[] } }>(b, '/api/friends/live');
    expect(view.room.members.find(m => m.displayName === 'live-a')?.state).toEqual(state);
    const raw = JSON.stringify(view); for (const hidden of [a.email, ownerB.email, a.profile.id, ownerB.profile.id, 'QA SECRET NOT PUBLISHED']) expect(raw).not.toContain(hidden);
    expect(await http(c, '/api/friends/live')).toEqual({ room: null });
    await http(c, '/api/friends/live/join', 'POST', { code: '00000' }, 400);
    await http(context, '/api/friends/live', 'DELETE', {}); expect(await http(context, '/api/friends/live')).toEqual({ room: null });
    await http(b, '/api/friends/live', 'DELETE', {}); expect(await http(b, '/api/friends/live')).toEqual({ room: null });
    await home(page); await noOverflow(page);
  } finally { await b.close(); await c.close(); }
});

test('BL-AUTH BL-WORK BL-UX actual Chromium registration/profile/logout/login/draft reload/finish/edit', async ({ context, page }) => {
  const owner = 'qa-8796-ui-' + randomUUID(), email = owner + '@example.test';
  await context.setExtraHTTPHeaders({ 'oai-authenticated-user-id': owner });
  await page.goto(base); await page.getByLabel('Как тебя зовут').fill('QA UI'); await page.getByLabel('Почта').fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Код восстановления' })).toBeVisible(); await page.getByRole('button', { name: 'Код сохранён' }).click(); await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Мой профиль', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Мой профиль' });
  await expect(dialog.getByLabel('Имя', { exact: true })).toBeVisible(); await expect(dialog.getByLabel('Вес тела, кг')).toBeVisible(); await expect(dialog.getByLabel('Часовой пояс')).toBeVisible();
  await dialog.getByLabel('Имя', { exact: true }).fill('QA Profile saved'); await dialog.getByLabel('Вес тела, кг').fill('74'); await dialog.getByLabel('Часовой пояс').fill('Europe/Amsterdam'); await dialog.getByRole('button', { name: 'Сохранить профиль' }).click(); await expect(dialog.getByText('Профиль сохранён')).toBeVisible();
  await dialog.getByRole('button', { name: 'Выйти из аккаунта' }).click(); await expect(page.getByRole('heading', { name: 'Снова в зале' })).toBeVisible();
  await page.getByLabel('Почта').fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти в Тягу' }).click(); await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click(); await page.getByLabel('Название тренировки').fill('QA UI persisted draft');
  await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click(); await page.getByRole('button', { name: 'Добавить Жим штанги лёжа', exact: true }).click(); await page.getByRole('button', { name: 'Готово', exact: true }).click();
  for (let i = 1; i <= 3; i++) { await page.getByLabel(`Жим штанги лёжа, подход ${i}, вес`, { exact: true }).fill('60'); await page.getByLabel(`Жим штанги лёжа, подход ${i}, повторы`, { exact: true }).fill('10'); await page.getByRole('button', { name: `Отметить выполненным: Жим штанги лёжа, подход ${i}`, exact: true }).click(); }
  await page.reload(); await page.getByRole('button', { name: 'Продолжить тренировку', exact: true }).click(); await expect(page.getByLabel('Название тренировки')).toHaveValue('QA UI persisted draft');
  await noOverflow(page); await page.screenshot({ path: test.info().outputPath('actual-workout.png'), fullPage: true });
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click(); await expect(page.getByRole('heading', { name: 'История тренировок' })).toBeVisible();
  const history = await http<{ workouts: Workout[] }>(context, '/api/data'); expect(history.workouts.length).toBe(1); expect(TrainingVolume.summarize(history.workouts).total).toBe(1800);
  await page.getByRole('button', { name: /QA UI persisted draft/ }).click(); await page.getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название тренировки').fill('QA UI edited'); await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect(page.getByText('QA UI edited', { exact: true })).toBeVisible();
  expect((await http<{ workouts: Workout[] }>(context, '/api/data')).workouts[0].name).toBe('QA UI edited');
});

test('BL-PROGRAM BL-UX actual Chromium five-day template and invalid rep range', async ({ context, page }) => {
  await fixture(context, 'program'); await home(page); await page.getByRole('link', { name: 'Программы', exact: true }).or(page.getByRole('button', { name: 'Программы', exact: true })).first().click(); await page.getByText('Программа v2 · 5 дней', { exact: true }).click();
  for (const name of ['Верх: грудь, спина, трапеция', 'Плечи и руки', 'Верх: спина, грудь, трапеция', 'Руки, плечи, предплечья', 'Ноги и икры']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('3 × 6–8').first()).toBeVisible(); await expect(page.getByText('6 × 12–20').first()).toBeVisible(); await noOverflow(page);
  const beforePrograms = (await http<{ routines: unknown[] }>(context, '/api/product')).routines;
  await page.getByRole('button', { name: 'Редактировать программу' }).first().click(); const modal = page.getByRole('dialog', { name: 'Редактировать программу' });
  const globalMin = modal.getByLabel('Повторы от', { exact: true }).first(), globalMax = modal.getByLabel('Повторы до', { exact: true }).first();
  await globalMin.fill('9'); await globalMax.fill('8'); await modal.getByRole('button', { name: 'Сохранить программу', exact: true }).click();
  const nativeRange = await globalMax.evaluate(node => { const input = node as HTMLInputElement; return { valid: input.checkValidity(), rangeUnderflow: input.validity.rangeUnderflow, validationMessage: input.validationMessage, value: input.value, min: input.min }; });
  expect(nativeRange.valid).toBe(false); expect(nativeRange.rangeUnderflow).toBe(true); expect(nativeRange.value).toBe('8'); expect(nativeRange.min).toBe('9'); expect(nativeRange.validationMessage.length).toBeGreaterThan(0); await expect(modal).toBeVisible(); expect((await http<{ routines: unknown[] }>(context, '/api/product')).routines).toEqual(beforePrograms); await proof('program-global-native-range-rejection', nativeRange);
  await globalMin.fill('8'); await globalMax.fill('12'); await modal.getByLabel('Повторы от', { exact: true }).nth(1).fill('9'); await modal.getByLabel('Повторы до', { exact: true }).nth(1).fill('8');
  await modal.getByRole('button', { name: 'Сохранить программу', exact: true }).click(); await expect(modal.getByRole('alert')).toHaveText(/максимум не меньше минимума/); expect((await http<{ routines: unknown[] }>(context, '/api/product')).routines).toEqual(beforePrograms);
});

test('BL-BACKUP BL-FAIL real HTTP metadata package atomicity/replay + actual Chromium v5 download/dry-run', async ({ context, page }) => {
  await fixture(context, 'backup'); const w = workout('QA backup sentinel'); await http(context, '/api/workouts', 'PUT', w);
  const m = MachineRegistry.create(); m.nickname = 'QA import metadata'; m.model.model = 'QA import selectorized station';
  const before = await http<{ machines: MachineInstance[] }>(context, '/api/product');
  await http(context, '/api/import/metadata', 'POST', { kind: 'machines', items: [m, { ...MachineRegistry.create(), nickname: 123 }] }, 400);
  expect((await http<{ machines: MachineInstance[] }>(context, '/api/product')).machines).toEqual(before.machines);
  const first = await http<{ created: number, skipped: number }>(context, '/api/import/metadata', 'POST', { kind: 'machines', items: [m] }); expect(first.created).toBe(1);
  const repeat = await http<{ created: number, skipped: number }>(context, '/api/import/metadata', 'POST', { kind: 'machines', items: [m] }); expect(repeat.created).toBe(0); expect(repeat.skipped).toBe(1);
  const parser = new WorkoutImport({ dateOrder: 'dmy', weightUnit: 'kg', distanceUnit: 'km', timeZone: 'UTC' });
  const parsedVersions = [1, 2, 3, 4, 5].map(version => { const preview = parser.parse(JSON.stringify({ version, workouts: [w] }), 'tyaga'); expect(preview.workouts).toHaveLength(1); return { version, workouts: preview.workouts.length, sets: preview.setCount }; });
  await proof('actual-pure-parser-versions-1-through-5', parsedVersions);
  const candidate = parser.parse(JSON.stringify({ version: 5, workouts: [workout('QA valid package first')] }), 'tyaga').workouts[0];
  const beforeInvalidPackage = await http(context, '/api/data');
  await http(context, '/api/import', 'POST', { format: 'tyaga', workouts: [candidate, { ...candidate, sourceKey: 'qa-invalid-' + randomUUID(), date: '2026-02-30' }] }, 400);
  expect(await http(context, '/api/data')).toEqual(beforeInvalidPackage);
  const imported = await http<{ imported: number, skipped: number, workouts: Workout[] }>(context, '/api/import', 'POST', { format: 'tyaga', workouts: [candidate] }); expect(imported.imported).toBe(1);
  const importedAgain = await http<{ imported: number, skipped: number }>(context, '/api/import', 'POST', { format: 'tyaga', workouts: [candidate] }); expect(importedAgain.imported).toBe(0); expect(importedAgain.skipped).toBe(1);
  const journal = await http(context, '/api/data');
  await home(page); await tools(page, 'Резервная копия'); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать полную копию' }).click(); const download = await downloadPromise; const path = test.info().outputPath('qa-v5-backup.json'); await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8')) as { format: string, version: number, workouts: Workout[], machines: MachineInstance[] };
  expect(backup.format).toBe('tyaga-backup'); expect(backup.version).toBe(5); expect(backup.workouts.some(x => x.name === w.name)).toBe(true); expect(backup.machines.some(x => x.id === m.id)).toBe(true); expect(JSON.stringify(backup)).not.toContain(password);
  await page.getByRole('button', { name: 'Восстановить из файла' }).click(); await page.getByLabel('Файл истории тренировок').setInputFiles(path); await page.getByRole('button', { name: 'Показать предпросмотр' }).click(); await expect(page.getByRole('button', { name: 'Импортировать', exact: true })).toBeVisible(); expect(await http(context, '/api/data')).toEqual(journal); await proof('actual-v5-browser-preview-not-committed', { source: download.suggestedFilename(), workouts: backup.workouts.length, note: 'Preview executed; no import button pressed; API journal unchanged' }); await noOverflow(page);
});

test('BL-TOOLS BL-POSE BL-UX actual Chromium calculators and invalid-video gate (NOT inference)', async ({ context, page }) => {
  await fixture(context, 'tools'); await home(page); await tools(page, 'Калькулятор 1ПМ'); const orm = page.getByRole('dialog'); await orm.getByRole('spinbutton').nth(0).fill('60'); await orm.getByRole('spinbutton').nth(1).fill('10'); await expect(orm.locator('.orm-hero-digits')).toHaveText('78.5'); await expect(orm.locator('.formula-pill').filter({ hasText: /^Epley:/ })).toHaveText('Epley: 80 кг'); await noOverflow(page); await page.keyboard.press('Escape');
  await tools(page, 'Анализ техники по видео'); await expect(page.getByRole('button', { name: 'Проанализировать видео' })).toBeDisabled(); await page.getByLabel('Видео подхода').setInputFiles({ name: 'qa-invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a video') }); await expect(page.getByRole('alert')).toHaveText('Нужен видеофайл'); await expect(page.getByRole('button', { name: 'Проанализировать видео' })).toBeDisabled(); await expect(page.getByText(/не отправляется на сервер/)).toBeVisible(); await noOverflow(page); await page.screenshot({ path: test.info().outputPath('actual-pose-invalid-gate.png'), fullPage: true });
});
