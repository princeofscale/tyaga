import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { makeWorkout } from '../src/lib/model';

test('production API persists edits, isolates identities and refuses anonymous/cross-origin writes', async () => {
  const mf = new Miniflare({ modules: true, scriptPath: 'dist/server/index.js', compatibilityDate: '2025-09-27', d1Databases: ['DB'], cf: false });
  try {
    const db = await mf.getD1Database('DB');
    const sql = await readFile('drizzle/0000_romantic_medusa.sql', 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) await db.prepare(statement.trim()).run();
    const base = 'http://localhost';
    const request = (path: string, method = 'GET', body?: unknown, owner: string | null = 'user-a', origin = base) => mf.dispatchFetch(base + path, { method, headers: { ...(owner ? { 'oai-authenticated-user-id': owner } : {}), Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await request('/api/data', 'GET', undefined, null)).status, 401);
    const w = makeWorkout(['bench']); w.exercises[0].sets[0].done = true; w.exercises[0].sets[0].weight = 60;
    assert.equal((await request('/api/workouts', 'PUT', w, 'user-a', 'https://other.example')).status, 403);
    assert.equal((await request('/api/workouts', 'PUT', w)).status, 200);
    let data = await (await request('/api/data')).json() as { workouts: typeof w[] };
    assert.equal(data.workouts.length, 1); assert.equal(data.workouts[0].exercises[0].sets[0].weight, 60);
    w.exercises[0].sets[0].weight = 70;
    assert.equal((await request('/api/workouts', 'PUT', w)).status, 200);
    data = await (await request('/api/data')).json() as typeof data;
    assert.equal(data.workouts.length, 1); assert.equal(data.workouts[0].exercises[0].sets[0].weight, 70);
    const other = await (await request('/api/data', 'GET', undefined, 'user-b')).json() as typeof data;
    assert.equal(other.workouts.length, 0);
    assert.equal((await request('/api/workouts', 'PUT', w, 'user-b')).status, 403);
    await request('/api/workouts/' + w.id, 'DELETE', undefined, 'user-b');
    data = await (await request('/api/data')).json() as typeof data;
    assert.equal(data.workouts.length, 1);
    await request('/api/workouts/' + w.id, 'DELETE');
    data = await (await request('/api/data')).json() as typeof data;
    assert.equal(data.workouts.length, 0);
  } finally { await mf.dispose(); }
});
