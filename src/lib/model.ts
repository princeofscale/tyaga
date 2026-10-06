export const MUSCLES = [
  { id: 'chest', name: 'Грудь', short: 'Грудь', goal: 10 },
  { id: 'back', name: 'Спина', short: 'Спина', goal: 12 },
  { id: 'shoulders', name: 'Плечи', short: 'Плечи', goal: 8 },
  { id: 'biceps', name: 'Бицепс', short: 'Бицепс', goal: 6 },
  { id: 'triceps', name: 'Трицепс', short: 'Трицепс', goal: 6 },
  { id: 'quads', name: 'Квадрицепс', short: 'Квадрицепс', goal: 10 },
  { id: 'hamstrings', name: 'Задняя поверхность бедра', short: 'Бицепс бедра', goal: 8 },
  { id: 'glutes', name: 'Ягодицы', short: 'Ягодицы', goal: 8 },
  { id: 'calves', name: 'Икры', short: 'Икры', goal: 6 },
  { id: 'core', name: 'Пресс', short: 'Пресс', goal: 6 },
] as const;
export type Muscle = typeof MUSCLES[number]['id'];
export type Equipment = 'gym' | 'dumbbells' | 'bodyweight';
export type Exercise = { id: string; name: string; primary: Muscle[]; secondary: Muscle[]; equipment: Equipment; tip: string; bodyweight?: boolean };
export const EXERCISES: Exercise[] = [
  { id: 'bench', name: 'Жим штанги лёжа', primary: ['chest'], secondary: ['triceps', 'shoulders'], equipment: 'gym', tip: 'Лопатки сведены, стопы на полу. Опускай штангу под контролем.' },
  { id: 'incline-db', name: 'Жим гантелей на наклонной', primary: ['chest'], secondary: ['triceps', 'shoulders'], equipment: 'dumbbells', tip: 'Небольшой наклон скамьи. Не теряй контроль в нижней точке.' },
  { id: 'fly', name: 'Сведение рук в кроссовере', primary: ['chest'], secondary: [], equipment: 'gym', tip: 'Локти слегка согнуты. Веди движение грудью, без рывков.' },
  { id: 'pushup', name: 'Отжимания', primary: ['chest'], secondary: ['triceps', 'shoulders'], equipment: 'bodyweight', bodyweight: true, tip: 'Держи корпус прямым. Выбери высоту опоры под свой уровень.' },
  { id: 'lat-pulldown', name: 'Тяга верхнего блока', primary: ['back'], secondary: ['biceps'], equipment: 'gym', tip: 'Тяни локти вниз. Не отклоняй корпус резко назад.' },
  { id: 'row', name: 'Тяга горизонтального блока', primary: ['back'], secondary: ['biceps'], equipment: 'gym', tip: 'Сохраняй нейтральное положение спины. Веди локти вдоль корпуса.' },
  { id: 'db-row', name: 'Тяга гантели в наклоне', primary: ['back'], secondary: ['biceps'], equipment: 'dumbbells', tip: 'Упрись свободной рукой. Не вращай корпус при подъёме.' },
  { id: 'pullup', name: 'Подтягивания', primary: ['back'], secondary: ['biceps'], equipment: 'gym', bodyweight: true, tip: 'Начинай без раскачки. Используй помощь, если она нужна.' },
  { id: 'ohp', name: 'Жим гантелей сидя', primary: ['shoulders'], secondary: ['triceps'], equipment: 'dumbbells', tip: 'Не прогибай поясницу. Поднимай гантели по комфортной траектории.' },
  { id: 'lateral', name: 'Махи гантелями в стороны', primary: ['shoulders'], secondary: [], equipment: 'dumbbells', tip: 'Лёгкий сгиб в локтях. Поднимай руки без раскачки.' },
  { id: 'facepull', name: 'Тяга каната к лицу', primary: ['shoulders'], secondary: ['back'], equipment: 'gym', tip: 'Тяни к уровню лица, разводя локти. Выбирай умеренный вес.' },
  { id: 'curl', name: 'Сгибание рук с гантелями', primary: ['biceps'], secondary: [], equipment: 'dumbbells', tip: 'Локти остаются на месте. Полностью контролируй опускание.' },
  { id: 'hammer', name: 'Молотковые сгибания', primary: ['biceps'], secondary: [], equipment: 'dumbbells', tip: 'Нейтральный хват. Не помогай корпусом.' },
  { id: 'triceps-push', name: 'Разгибание рук на блоке', primary: ['triceps'], secondary: [], equipment: 'gym', tip: 'Прижми локти к корпусу. Не поднимай плечи.' },
  { id: 'triceps-db', name: 'Разгибание гантели из-за головы', primary: ['triceps'], secondary: [], equipment: 'dumbbells', tip: 'Работай в комфортной амплитуде, без боли в локтях.' },
  { id: 'squat', name: 'Приседания со штангой', primary: ['quads', 'glutes'], secondary: ['hamstrings', 'core'], equipment: 'gym', tip: 'Стой устойчиво. Колени движутся по направлению носков.' },
  { id: 'legpress', name: 'Жим ногами', primary: ['quads'], secondary: ['glutes'], equipment: 'gym', tip: 'Не отрывай таз от спинки. Не выпрямляй колени резко.' },
  { id: 'goblet', name: 'Гоблет-присед', primary: ['quads', 'glutes'], secondary: ['core'], equipment: 'dumbbells', tip: 'Держи гантель у груди. Выбери комфортную глубину.' },
  { id: 'lunge', name: 'Выпады с гантелями', primary: ['quads', 'glutes'], secondary: ['hamstrings'], equipment: 'dumbbells', tip: 'Записывай повторы на одну ногу. Сохраняй устойчивую опору.' },
  { id: 'body-squat', name: 'Приседания без веса', primary: ['quads', 'glutes'], secondary: ['core'], equipment: 'bodyweight', bodyweight: true, tip: 'Контролируй темп. Сохраняй стопы прижатыми к полу.' },
  { id: 'rdl', name: 'Румынская тяга', primary: ['hamstrings', 'glutes'], secondary: ['back'], equipment: 'gym', tip: 'Уводи таз назад, слегка сгибая колени. Держи спину нейтрально.' },
  { id: 'db-rdl', name: 'Румынская тяга с гантелями', primary: ['hamstrings', 'glutes'], secondary: ['back'], equipment: 'dumbbells', tip: 'Опускай гантели близко к ногам. Движение начинается от таза.' },
  { id: 'legcurl', name: 'Сгибание ног в тренажёре', primary: ['hamstrings'], secondary: [], equipment: 'gym', tip: 'Настрой ось тренажёра под колени. Не отрывай таз.' },
  { id: 'hipthrust', name: 'Ягодичный мост', primary: ['glutes'], secondary: ['hamstrings'], equipment: 'bodyweight', bodyweight: true, tip: 'Поднимай таз без избыточного прогиба в пояснице.' },
  { id: 'calf', name: 'Подъём на носки', primary: ['calves'], secondary: [], equipment: 'bodyweight', bodyweight: true, tip: 'Полная комфортная амплитуда. Делай паузу наверху.' },
  { id: 'crunch', name: 'Скручивания', primary: ['core'], secondary: [], equipment: 'bodyweight', bodyweight: true, tip: 'Не тяни голову руками. Поднимай верх спины под контролем.' },
];
export type SetEntry = { id: string; weight: number; reps: number; rir: number; warmup: boolean; done: boolean };
export type WorkoutExercise = { exerciseId: string; sets: SetEntry[] };
export type Workout = { id: string; name: string; date: string; duration: number; notes: string; exercises: WorkoutExercise[] };
export type Settings = { goals: Record<Muscle, number>; equipment: Equipment; restSeconds: number };
export type MuscleLoad = { id: Muscle; name: string; short: string; direct: number; indirect: number; total: number; goal: number; ratio: number };
export const DEFAULT_SETTINGS: Settings = { goals: Object.fromEntries(MUSCLES.map(m => [m.id, m.goal])) as Record<Muscle, number>, equipment: 'gym', restSeconds: 90 };
export const exerciseById = (id: string) => EXERCISES.find(e => e.id === id);
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function weekStart(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDate(d); }
export const effortFactor = (rir: number) => rir <= 3 ? 1 : rir <= 5 ? 0.75 : 0.5;
export function muscleLoad(workouts: Workout[], settings = DEFAULT_SETTINGS): MuscleLoad[] {
  const loads = MUSCLES.map(m => ({ ...m, direct: 0, indirect: 0, total: 0, goal: settings.goals[m.id] ?? m.goal, ratio: 0 }));
  for (const w of workouts) for (const we of w.exercises) {
    const e = exerciseById(we.exerciseId); if (!e) continue;
    for (const set of we.sets) {
      if (!set.done || set.warmup) continue;
      const factor = effortFactor(set.rir);
      for (const m of loads) {
        if (e.primary.includes(m.id)) m.direct += factor;
        else if (e.secondary.includes(m.id)) m.indirect += factor * 0.5;
      }
    }
  }
  return loads.map(m => ({ ...m, total: m.direct + m.indirect, ratio: (m.direct + m.indirect) / m.goal }));
}
export function balanceScore(loads: MuscleLoad[]) { return Math.round(loads.reduce((s, m) => s + Math.min(m.ratio, 1), 0) / loads.length * 100); }
export const volume = (workouts: Workout[]) => workouts.reduce((sum, w) => sum + w.exercises.reduce((v, e) => v + e.sets.filter(s => s.done && !s.warmup).reduce((a, s) => a + s.weight * s.reps, 0), 0), 0);
export const workingSets = (workouts: Workout[]) => workouts.reduce((s, w) => s + w.exercises.reduce((n, e) => n + e.sets.filter(x => x.done && !x.warmup).length, 0), 0);
export function estimatedOneRepMax(set: SetEntry) { if (!set.done || set.warmup || set.weight <= 0 || set.reps > 12) return null; return set.reps === 1 ? set.weight : set.weight * (1 + set.reps / 30); }
export function makeSets(count = 3, weight = 0, reps = 10): SetEntry[] { return Array.from({ length: count }, () => ({ id: crypto.randomUUID(), weight, reps, rir: 2, warmup: false, done: false })); }
export function makeWorkout(ids: string[] = [], history: Workout[] = []): Workout {
  return { id: crypto.randomUUID(), name: 'Новая тренировка', date: localDate(), duration: 0, notes: '', exercises: ids.map(exerciseId => {
    const last = [...history].sort((a, b) => b.date.localeCompare(a.date)).flatMap(w => w.exercises).find(e => e.exerciseId === exerciseId)?.sets.find(s => s.done && !s.warmup);
    return { exerciseId, sets: makeSets(3, last?.weight ?? 0, last?.reps ?? 10) };
  }) };
}
export function buildBalancePlan(loads: MuscleLoad[], minutes: number, equipment: Equipment, excluded: Muscle[] = []) {
  const remaining = Object.fromEntries(loads.map(m => [m.id, Math.max(0, m.goal - m.total)])) as Record<Muscle, number>;
  const maxExercises = Math.max(1, Math.min(6, Math.floor((minutes - 3) / 8)));
  const pool = EXERCISES.filter(e => (equipment === 'gym' || e.equipment === equipment || e.equipment === 'bodyweight') && ![...e.primary, ...e.secondary].some(m => excluded.includes(m)));
  const picks: { exercise: Exercise; reason: string; gains: Partial<Record<Muscle, number>> }[] = [];
  for (let i = 0; i < maxExercises; i++) {
    const candidates = pool.filter(e => !picks.some(p => p.exercise.id === e.id)).map(e => ({ e, score: e.primary.reduce((s, m) => s + Math.min(remaining[m], 3), 0) + e.secondary.reduce((s, m) => s + Math.min(remaining[m], 1.5) * 0.5, 0) })).sort((a, b) => b.score - a.score);
    const best = candidates[0]; if (!best || best.score <= 0) break;
    const target = [...best.e.primary].sort((a, b) => remaining[b] - remaining[a])[0];
    const muscle = loads.find(m => m.id === target)!;
    const gains: Partial<Record<Muscle, number>> = {};
    best.e.primary.forEach(m => { gains[m] = 3; remaining[m] = Math.max(0, remaining[m] - 3); });
    best.e.secondary.forEach(m => { gains[m] = 1.5; remaining[m] = Math.max(0, remaining[m] - 1.5); });
    picks.push({ exercise: best.e, reason: `${muscle.short}: ${fmt(muscle.total)} из ${muscle.goal} подходов за неделю. Добавит 3 прямых подхода.`, gains });
  }
  const projected = loads.map(m => { const total = m.total + picks.reduce((s, p) => s + (p.gains[m.id] ?? 0), 0); return { ...m, total, ratio: total / m.goal }; });
  return { picks, minutes: picks.length ? 3 + picks.length * 8 : 0, before: balanceScore(loads), after: balanceScore(projected), projected };
}
export const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
export function demoWorkouts(now = new Date()): Workout[] {
  const start = new Date(`${weekStart(now)}T12:00:00`);
  const workouts: Workout[] = [];
  for (let week = 3; week >= 0; week--) for (let day = 0; day < 3; day++) {
    const date = new Date(start); date.setDate(date.getDate() - week * 7 + day * 2);
    if (localDate(date) > localDate(now)) continue;
    const ids = day === 0 ? ['bench', 'incline-db', 'ohp', 'triceps-push'] : day === 1 ? ['lat-pulldown', 'row', 'curl', 'facepull'] : ['squat', 'legpress', 'bench', 'crunch'];
    const weights = day === 0 ? [60 + (3 - week) * 2.5, 20, 16, 25] : day === 1 ? [50, 45, 12, 15] : [60, 100, 60 + (3 - week) * 2.5, 0];
    workouts.push({ id: `demo-${week}-${day}`, date: localDate(date), name: ['Грудь и плечи', 'Спина и руки', 'Ноги и грудь'][day], duration: [52, 48, 61][day], notes: '', exercises: ids.map((exerciseId, j) => ({ exerciseId, sets: Array.from({ length: 3 + (j === 0 ? 1 : 0) }, (_, k) => ({ id: `s-${k}`, weight: weights[j], reps: 10 - (k % 2) * 2, rir: 2, warmup: false, done: true })) })) });
  }
  return workouts.sort((a, b) => b.date.localeCompare(a.date));
}
