import { useEffect, useRef } from 'react';
import { balanceScore, buildBalancePlan, makeWorkout, type MuscleLoad, type Workout, type Equipment } from './model';
import type { Draft } from '../components/WorkoutView';

export function useTrainingTools(state: { draft: Draft | null; workouts: Workout[]; loads: MuscleLoad[]; stage: (workout: Workout) => void }) {
  const latest = useRef(state); latest.current = state;
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional browser API. */ } };
    register({ name: 'read_training_balance', title: 'Баланс тренировок', description: 'Read the signed-in user’s actual muscle load this week. Demo examples are excluded.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected empty object'); return { score: balanceScore(latest.current.loads), muscles: latest.current.loads.map(m => ({ muscle: m.id, direct: m.direct, indirect: m.indirect, goal: m.goal })) }; } });
    register({ name: 'stage_balanced_workout', title: 'Подготовить тренировку', description: 'Stage a workout draft from actual saved history. Does not log or complete a workout. Refuses to replace an existing draft.', inputSchema: { type: 'object', properties: { minutes: { type: 'integer', enum: [20, 40, 60] }, equipment: { type: 'string', enum: ['gym', 'dumbbells', 'bodyweight'] } }, required: ['minutes', 'equipment'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: unknown) => { const p = input as { minutes: number; equipment: Equipment }; if (!p || Object.keys(p).some(k => !['minutes', 'equipment'].includes(k)) || ![20, 40, 60].includes(p.minutes) || !['gym', 'dumbbells', 'bodyweight'].includes(p.equipment)) throw new Error('Invalid workout preferences'); const s = latest.current; if (s.draft) throw new Error('An active draft already exists'); const plan = buildBalancePlan(s.loads, p.minutes, p.equipment); if (!plan.picks.length) return { staged: false, reason: 'No remaining volume gaps' }; const workout = makeWorkout(plan.picks.map(p => p.exercise.id), s.workouts); workout.name = 'Баланс недели'; s.stage(workout); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); return { staged: true, exerciseIds: workout.exercises.map(e => e.exerciseId) }; } });
    return () => lifecycle.abort();
  }, []);
}
