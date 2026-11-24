// Честный годовой Strong-экспорт: 52 недели, ~4 тренировки в неделю, десятки разных упражнений.
import fs from 'node:fs';
const OUT = process.argv[2], EXP = process.argv[3];
let seed = 20261114; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const BARBELL = ['Bench Press (Barbell)', 'Overhead Press (Barbell)', 'Squat (Barbell)', 'Romanian Deadlift (Barbell)', 'Deadlift (Barbell)', 'Bent Over Row (Barbell)'];
const DAYS = [{ n: 'Грудь/Плечи', base: ['Bench Press (Barbell)', 'Overhead Press (Barbell)'], pool: ['Incline Bench Press (Dumbbell)', 'Chest Fly (Dumbbell)', 'Pec Deck (Machine)', 'Lateral Raise (Dumbbell)', 'Triceps Pushdown (Cable)', 'Dip', 'Arnold Press (Dumbbell)', 'Close Grip Bench Press (Barbell)', 'Decline Bench Press (Barbell)', 'Smith Machine Bench Press', 'Skullcrusher (Barbell)', 'Overhead Triceps Extension (Cable)'] },
  { n: 'Ноги', base: ['Squat (Barbell)', 'Romanian Deadlift (Barbell)'], pool: ['Leg Press (Machine)', 'Leg Extension (Machine)', 'Seated Leg Curl (Machine)', 'Bulgarian Split Squat (Dumbbell)', 'Walking Lunge (Dumbbell)', 'Hip Thrust (Barbell)', 'Calf Raise (Machine)', 'Standing Calf Raise (Smith Machine)', 'Front Squat (Barbell)', 'Hack Squat (Machine)', 'Goblet Squat (Kettlebell)', 'Good Morning (Barbell)'] },
  { n: 'Тяга', base: ['Deadlift (Barbell)', 'Bent Over Row (Barbell)'], pool: ['Lat Pulldown (Cable)', 'Seated Row (Machine)', 'Pull Up', 'Chin Up', 'Face Pull (Cable)', 'Bicep Curl (Dumbbell)', 'Hammer Curl (Dumbbell)', 'T-Bar Row', 'One Arm Row (Dumbbell)', 'Incline Curl (Dumbbell)', 'Preacher Curl (Barbell)', 'Shrug (Dumbbell)', 'Pendlay Row (Barbell)', 'Sumo Deadlift (Barbell)', 'Rear Delt Fly (Machine)', 'Back Extension'] },
  { n: 'Корпус/Кардио', base: ['Plank', 'Hanging Leg Raise'], pool: ['Cable Crunch', 'Push Up', 'Kettlebell Swing', 'Farmers Walk (Dumbbell)', 'Back Extension', 'Dip', 'Pull Up'] }];
const end = new Date(Date.UTC(2026, 10, 13)); const start = new Date(end.getTime() - 363 * 86400000);
const rows = [], ex = { workouts: 0, sets: 0, rawTonnageKg: 0, mappedTonnageKg: 0, mappedSets: 0, names: new Set(), barbellNames: new Set() };
for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
  const dow = d.getUTCDay(); // Пн, Вт, Чт, Сб = 1,2,4,6; изредка пропуск недели
  const week = Math.floor((d - start) / (7 * 86400000));
  const dows = [1, 2, 4, 5, 6];
  if (!dows.includes(dow) || (week % 13 === 12)) continue;
  const day = DAYS[(week + dows.indexOf(dow)) % 4];
  const date = `${d.toISOString().slice(0, 10)} ${pick(['07:30', '18:00', '18:30', '19:15'])}:00`;
  const exs = [...day.base, ...[...day.pool].sort(() => rnd() - .5).slice(0, 2 + Math.floor(rnd() * 3))];
  ex.workouts++;
  for (const name of exs) {
    const n = 3 + Math.floor(rnd() * 3); const isBar = BARBELL.includes(name);
    const w0 = isBar ? 40 + Math.floor(rnd() * 12) * 5 : /Plank|Push Up|Pull Up|Chin Up|Dip|Hanging|Back Extension/.test(name) ? 0 : 10 + Math.floor(rnd() * 10) * 2.5;
    for (let s = 1; s <= n; s++) {
      const weight = w0 + (rnd() < .3 ? 2.5 : 0), reps = 5 + Math.floor(rnd() * 8), rpe = rnd() < .7 ? String(7 + Math.floor(rnd() * 3)) : '';
      const sec = /Plank|Farmers/.test(name) ? 30 + Math.floor(rnd() * 5) * 15 : 0;
      rows.push(`${date},${day.n},${1 + Math.floor(rnd() * 2)}h ${5 * Math.floor(rnd() * 12)}m,${name},${s},${weight},${reps},0,${sec},,,${rpe}`);
      ex.sets++; ex.rawTonnageKg += weight * reps; ex.names.add(name);
      if (isBar) { ex.mappedTonnageKg += weight * reps; ex.mappedSets++; ex.barbellNames.add(name); }
    }
  }
}
fs.writeFileSync(OUT, ['Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE', ...rows].join('\n') + '\n');
const summary = { workouts: ex.workouts, sets: ex.sets, rawTonnageKg: ex.rawTonnageKg, mappedBarbellTonnageKg: ex.mappedTonnageKg, mappedBarbellSets: ex.mappedSets, distinctExerciseNames: ex.names.size, barbellNames: ex.barbellNames.size, csvBytes: fs.statSync(OUT).size, csvRows: rows.length, firstDate: rows[0].slice(0, 10), lastDate: rows.at(-1).slice(0, 10) };
fs.writeFileSync(EXP, JSON.stringify(summary, null, 2)); console.log(summary);
