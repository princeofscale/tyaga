import { DEFAULT_SETTINGS } from '../src/lib/model';
import { validWorkout, validSettings, InputError } from './validation';
interface Env { DB: D1Database; ASSETS: Fetcher; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) return json({ error: 'Войдите в аккаунт, чтобы сохранить тренировки.' }, 401);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (!origin || origin !== url.origin) return json({ error: 'Недопустимый источник запроса' }, 403);
    if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return json({ error: 'Требуется JSON' }, 415);
  }
  try {
    if (request.method === 'GET' && url.pathname === '/api/data') {
      const [rows, setting] = await Promise.all([
        env.DB.prepare('SELECT payload FROM workouts WHERE owner_id = ? ORDER BY date DESC').bind(userId).all<{ payload: string }>(),
        env.DB.prepare('SELECT payload FROM settings WHERE owner_id = ?').bind(userId).first<{ payload: string }>(),
      ]);
      return json({ workouts: rows.results.map(r => JSON.parse(r.payload)), settings: setting ? JSON.parse(setting.payload) : DEFAULT_SETTINGS });
    }
    if (request.method === 'PUT' && url.pathname === '/api/settings') {
      const value = validSettings(await readBody(request));
      await env.DB.prepare('INSERT INTO settings (owner_id, payload) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload').bind(userId, JSON.stringify(value)).run();
      return json({ settings: value });
    }
    if (request.method === 'PUT' && url.pathname === '/api/workouts') {
      const w = validWorkout(await readBody(request));
      await env.DB.prepare('INSERT INTO workouts (id, owner_id, date, payload, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, payload = excluded.payload, updated_at = excluded.updated_at WHERE workouts.owner_id = excluded.owner_id').bind(w.id, userId, w.date, JSON.stringify(w), new Date().toISOString()).run();
      const saved = await env.DB.prepare('SELECT id FROM workouts WHERE id = ? AND owner_id = ?').bind(w.id, userId).first();
      if (!saved) return json({ error: 'Тренировка недоступна' }, 403);
      return json({ workout: w });
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/workouts/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/workouts/'.length));
      if (!id || id.length > 80) throw new InputError('Некорректный ID');
      await env.DB.prepare('DELETE FROM workouts WHERE id = ? AND owner_id = ?').bind(id, userId).run();
      return json({ deleted: id });
    }
    return json({ error: 'Не найдено' }, 404);
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    if (error instanceof SyntaxError) return json({ error: 'Некорректный JSON' }, 400);
    console.error('Workout storage request failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'Не удалось обратиться к хранилищу. Данные в форме сохранены — попробуйте ещё раз.' }, 503);
  }
}
async function readBody(request: Request) { const body = await request.text(); if (body.length > 200000) throw new InputError('Слишком большой запрос'); return JSON.parse(body); }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'");
    return new Response(response.body, { status: response.status, headers });
  },
};
