import { EXERCISES, MUSCLES, type Workout, type Settings } from '../src/lib/model';

export class InputError extends Error {}
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InputError('Некорректные данные'); return v as Record<string, unknown>; };
function str(v: unknown, max: number, min = 0) { if (typeof v !== 'string' || v.length > max || v.trim().length < min) throw new InputError('Проверьте текстовые поля'); return v.trim(); }
function num(v: unknown, min: number, max: number, integer = false) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new InputError('Проверьте числовые поля'); return v; }
function bool(v: unknown) { if (typeof v !== 'boolean') throw new InputError('Некорректное значение'); return v; }
export function validWorkout(value: unknown): Workout {
  const w = object(value); const date = str(w.date, 10);
  const parsedDate = new Date(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new InputError('Проверьте дату');
  if (date > new Date().toISOString().slice(0, 10)) throw new InputError('Дата тренировки не может быть в будущем');
  if (!Array.isArray(w.exercises) || !w.exercises.length || w.exercises.length > 30) throw new InputError('Добавьте хотя бы одно упражнение');
  const seen = new Set<string>();
  const exercises = w.exercises.map(value => {
    const e = object(value); const exerciseId = str(e.exerciseId, 80, 1);
    if (!EXERCISES.some(x => x.id === exerciseId) || seen.has(exerciseId)) throw new InputError('Некорректное упражнение'); seen.add(exerciseId);
    if (!Array.isArray(e.sets) || !e.sets.length || e.sets.length > 30) throw new InputError('Добавьте подходы');
    return { exerciseId, sets: e.sets.map(value => { const s = object(value); return { id: str(s.id, 80, 1), weight: num(s.weight, 0, 1000), reps: num(s.reps, 1, 200, true), rir: num(s.rir, 0, 10, true), done: bool(s.done), warmup: bool(s.warmup) }; }) };
  });
  if (!exercises.some(e => e.sets.some(s => s.done))) throw new InputError('Отметьте хотя бы один выполненный подход');
  return { id: str(w.id, 80, 1), name: str(w.name, 120, 1), date, duration: num(w.duration, 0, 1440), notes: str(w.notes, 2000), exercises };
}
export function validSettings(value: unknown): Settings {
  const v = object(value); const goals = object(v.goals);
  if (!['gym', 'dumbbells', 'bodyweight'].includes(String(v.equipment))) throw new InputError('Проверьте оборудование');
  return { goals: Object.fromEntries(MUSCLES.map(m => [m.id, num(goals[m.id], 1, 40, true)])) as Settings['goals'], equipment: v.equipment as Settings['equipment'], restSeconds: num(v.restSeconds, 15, 600, true) };
}
