import { useEffect, useState } from 'react';
import { Check, Plus, Timer, Trash2, Save, Pause, Play, RotateCcw, Info } from 'lucide-react';
import { EXERCISES, MUSCLES, fmt, localDate, makeSets, workingSets, type Workout, type SetEntry, type Settings } from '../lib/model';

export type Draft = { workout: Workout; startedAt: number; editing: boolean };
export default function WorkoutView({ draft, update, settings, saving, error, onPick, onSave, onDiscard }: { draft: Draft | null; update: (draft: Draft) => void; settings: Settings; saving: boolean; error: string; onPick: () => void; onSave: () => void; onDiscard: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [pausedRest, setPausedRest] = useState<number | null>(null);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const remaining = pausedRest ?? (restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0);
  if (!draft) return <div className="empty-state"><div className="empty-icon"><Play size={30} /></div><h2>Время сделать первый подход</h2><p>Выбери упражнения и записывай вес, повторы и запас повторений.</p><button className="button primary" onClick={onPick}><Plus size={18} />Начать тренировку</button></div>;
  const w = draft.workout;
  const setWorkout = (workout: Workout) => update({ ...draft, workout });
  const changeSet = (ei: number, si: number, patch: Partial<SetEntry>) => { setWorkout({ ...w, exercises: w.exercises.map((e, i) => i === ei ? { ...e, sets: e.sets.map((s, j) => j === si ? { ...s, ...patch } : s) } : e) }); if (patch.done) { setRestUntil(Date.now() + settings.restSeconds * 1000); setPausedRest(null); } };
  const elapsed = draft.editing ? w.duration : Math.floor((now - draft.startedAt) / 60000);
  return <div className="workout-layout">
    <div className="workout-main">
      <div className="workout-meta"><label>Название тренировки<input value={w.name} maxLength={120} onChange={e => setWorkout({ ...w, name: e.target.value })} /></label><label>Дата<input type="date" max={localDate()} value={w.date} onChange={e => setWorkout({ ...w, date: e.target.value })} /></label>{draft.editing ? <label>Минуты<input type="number" min="0" max="1440" value={w.duration} onChange={e => setWorkout({ ...w, duration: Number(e.target.value) })} /></label> : null}</div>
      <div className="session-hint"><Info size={16} /><span>RIR — сколько повторений осталось в запасе. 0 — ни одного, 2 — ещё два.</span></div>
      {w.exercises.map((we, ei) => { const exercise = EXERCISES.find(e => e.id === we.exerciseId)!; return <article className="exercise-card" key={we.exerciseId}>
        <div className="exercise-card-head"><span className="exercise-number">{String(ei + 1).padStart(2, '0')}</span><div><h3>{exercise.name}</h3><p>{exercise.primary.map(id => MUSCLES.find(m => m.id === id)!.short).join(' · ')}</p></div><button className="icon-button" aria-label={`Убрать ${exercise.name}`} onClick={() => setWorkout({ ...w, exercises: w.exercises.filter((_, i) => i !== ei) })}><Trash2 size={17} /></button></div>
        <div className="sets-table"><div className="sets-header"><span>Подход</span><span>{exercise.bodyweight ? 'Доп. кг' : 'Вес, кг'}</span><span>Повторы</span><span>RIR</span><span>Готово</span><span /></div>
          {we.sets.map((s, si) => <div className={`set-row ${s.done ? 'done' : ''}`} key={s.id}>
            <button className={`set-kind ${s.warmup ? 'warmup' : ''}`} title="Нажми, чтобы переключить рабочий / разминочный подход" aria-label={`Подход ${si + 1}: ${s.warmup ? 'разминочный' : 'рабочий'}. Переключить тип`} onClick={() => changeSet(ei, si, { warmup: !s.warmup })}>{s.warmup ? 'Р' : si + 1}</button>
            <input aria-label={`${exercise.name}, подход ${si + 1}, вес`} type="number" min="0" max="1000" step="0.5" inputMode="decimal" value={s.weight} onChange={e => changeSet(ei, si, { weight: Number(e.target.value) })} />
            <input aria-label={`${exercise.name}, подход ${si + 1}, повторы`} type="number" min="1" max="200" inputMode="numeric" value={s.reps} onChange={e => changeSet(ei, si, { reps: Number(e.target.value) })} />
            <input aria-label={`${exercise.name}, подход ${si + 1}, RIR`} type="number" min="0" max="10" inputMode="numeric" value={s.rir} onChange={e => changeSet(ei, si, { rir: Number(e.target.value) })} />
            <button className="set-check" aria-label={`${s.done ? 'Снять отметку' : 'Отметить выполненным'}: ${exercise.name}, подход ${si + 1}`} aria-pressed={s.done} onClick={() => changeSet(ei, si, { done: !s.done })}><Check size={19} /></button>
            <button className="remove-set" disabled={we.sets.length <= 1} aria-label={`Удалить подход ${si + 1}`} onClick={() => setWorkout({ ...w, exercises: w.exercises.map((e, i) => i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e) })}><Trash2 size={14} /></button>
          </div>)}
        </div><button className="add-set" disabled={we.sets.length >= 30} onClick={() => { const previous = we.sets.at(-1)!; setWorkout({ ...w, exercises: w.exercises.map((e, i) => i === ei ? { ...e, sets: [...e.sets, ...makeSets(1, previous.weight, previous.reps)] } : e) }); }}><Plus size={15} />Добавить подход</button>
      </article>; })}
      <button className="button secondary full-width" disabled={w.exercises.length >= 30} onClick={onPick}><Plus size={18} />Добавить упражнение</button>
      <label className="notes-label">Заметки<textarea rows={3} placeholder="Как самочувствие? Что стоит помнить в следующий раз?" value={w.notes} maxLength={2000} onChange={e => setWorkout({ ...w, notes: e.target.value })} /></label>
    </div>
    <aside className="workout-summary panel">
      <div className="eyebrow">{draft.editing ? 'РЕДАКТИРОВАНИЕ' : 'ТРЕНИРОВКА ИДЁТ'}</div><div className="session-time">{elapsed}<span> мин</span></div><div className="session-summary-stats"><span>Упражнения<b>{w.exercises.length}</b></span><span>Рабочие подходы<b>{workingSets([w])}</b></span><span>Объём<b>{fmt(w.exercises.reduce((sum, e) => sum + e.sets.filter(s => s.done && !s.warmup).reduce((v, s) => v + s.weight * s.reps, 0), 0))} кг</b></span></div>
      <div className="rest-timer"><div className="card-label"><Timer size={16} />Отдых между подходами</div><div className={remaining ? 'rest-digits active' : 'rest-digits'} aria-live="off">{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</div><div className="timer-buttons"><button className="icon-button" aria-label="Запустить таймер заново" onClick={() => { setRestUntil(Date.now() + settings.restSeconds * 1000); setPausedRest(null); }}><RotateCcw size={18} /></button><button className="icon-button" aria-label={pausedRest !== null ? 'Продолжить таймер' : 'Приостановить таймер'} onClick={() => { if (pausedRest !== null) { setRestUntil(Date.now() + pausedRest * 1000); setPausedRest(null); } else if (remaining) { setPausedRest(remaining); setRestUntil(null); } }} disabled={!remaining}>{pausedRest !== null ? <Play size={18} /> : <Pause size={18} />}</button><button className="timer-plus" onClick={() => { if (pausedRest !== null) setPausedRest(pausedRest + 15); else setRestUntil(Math.max(Date.now(), restUntil ?? 0) + 15000); }}>+15 с</button></div><span className="tiny">Запускается после отметки подхода</span></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}<button className="button primary full-width" onClick={onSave} disabled={saving || !w.exercises.some(e => e.sets.some(s => s.done))}><Save size={17} />{saving ? 'Сохраняем…' : draft.editing ? 'Сохранить изменения' : 'Завершить тренировку'}</button><button className="text-button discard" disabled={saving} onClick={onDiscard}>{draft.editing ? 'Отменить изменения' : 'Отменить тренировку'}</button><p className="tiny draft-note">Черновик сохраняется на этом устройстве. Завершённые тренировки — в аккаунте.</p>
    </aside>
  </div>;
}
