import { fmt, localDate, volume, type Workout } from '../lib/model';

export function VolumeChart({ workouts }: { workouts: Workout[] }) {
  const days = Array.from({ length: 28 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 27 + i); return { date: localDate(d), day: d.getDate(), value: volume(workouts.filter(w => w.date === localDate(d))) }; });
  const max = Math.max(...days.map(d => d.value), 1);
  return <div className="volume-chart" role="img" aria-label={`Объём за 28 дней: ${fmt(days.reduce((s, d) => s + d.value, 0))} кг`}>
    <div className="volume-y"><span>{fmt(max / 1000)} т</span><span>{fmt(max / 2000)} т</span><span>0</span></div>
    <div className="volume-bars">{days.map((d, i) => <div className="bar-column" key={d.date}><div className={`bar ${i >= 21 ? 'recent' : ''}`} style={{ height: `${Math.max(d.value ? 5 : 2, d.value / max * 100)}%` }} title={`${d.date}: ${fmt(d.value)} кг`} /><span>{i % 7 === 0 || i === 27 ? d.day : ''}</span></div>)}</div>
  </div>;
}
export function Sparkline({ values, color = '#c8f36b' }: { values: number[]; color?: string }) {
  const min = Math.min(...values, 0); const max = Math.max(...values, 1); const delta = max - min || 1;
  const points = values.map((v, i) => `${i / Math.max(values.length - 1, 1) * 200},${57 - (v - min) / delta * 48}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 200 65" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
}
