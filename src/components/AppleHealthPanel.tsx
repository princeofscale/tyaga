import { useEffect, useRef, useState } from "react";
import { Watch, Heart, Flame, Upload, Trash2 } from "lucide-react";
import type { Workout, WearableSummary } from "../lib/types";
import type { HealthWorkoutCandidate } from "../domain/AppleHealthImport";
import { fmt } from "../lib/model";
import { api, ApiError } from "../services/ApiClient";

export default function AppleHealthPanel({ workout, onSaved, readOnly = false }: { workout:Workout; onSaved:(w:Workout)=>void; readOnly?:boolean }) {
  const [candidates,setCandidates] = useState<HealthWorkoutCandidate[] | null>(null), [error,setError] = useState(""), [saving,setSaving] = useState(false), [processing,setProcessing] = useState(false), [progress,setProgress] = useState(0);
  const busy = saving || processing;
  const worker = useRef<Worker | null>(null);
  const [conflict,setConflict] = useState<Workout | null>(null);
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const save = async (wearable?:WearableSummary) => {
    setSaving(true); setError(""); setConflict(null);
    try { const result = await api<{workout:Workout}>("/api/workouts","PUT",{...workout,wearable}); onSaved(result.workout); setCandidates(null); }
    catch(e) { setError(e instanceof Error ? e.message : "Не удалось сохранить показатели"); if(e instanceof ApiError && e.status === 409) setConflict(e.data.current ?? null); }
    finally { setSaving(false); }
  };
  const h = workout.wearable;
  return <section className="apple-health-panel">
    <div className="panel-header"><h3><Watch size={18} /> Apple Watch</h3>{h && !readOnly && <button className="icon-button" disabled={busy} aria-label="Удалить показатели Apple Watch" onClick={()=>void save()}><Trash2 size={15}/></button>}</div>
    {h ? <><div className="watch-metrics"><div><Heart size={17}/><span>Средний пульс</span><b>{h.heartRateAverage ? fmt(h.heartRateAverage) : "—"}<small>уд/мин</small></b></div><div><Flame size={17}/><span>{h.energyKind === "active" ? "Активная энергия" : "Энергия по экспорту"}</span><b>{h.caloriesKcal !== undefined ? fmt(h.caloriesKcal) : "—"}<small>ккал</small></b></div></div><p className="tiny">{h.sourceName} · {h.heartRateSamples} показаний пульса{h.heartRateMin ? ` · диапазон ${fmt(h.heartRateMin)}–${fmt(h.heartRateMax ?? h.heartRateMin)} уд/мин` : ""}. Калории — оценка устройства.</p></> : <p className="tiny">После тренировки добавь пульс и калории из Apple Health. Прямого подключения часов в браузере пока нет.</p>}
    {!readOnly && <details className="watch-import" open={busy || candidates !== null || !!error || undefined}>
      <summary>{h ? "Заменить данные из Apple Health" : "Импорт из Apple Health"}</summary>
      <ol><li>На часах включи «Традиционная силовая» или «Функциональная силовая».</li><li>На iPhone: «Здоровье» → профиль → «Экспортировать все данные». Сохрани ZIP в «Файлы».</li><li>Выбери архив или export.xml и нужную силовую тренировку за {workout.date}.</li></ol>
      <p className="tiny">Файл разбирается на этом устройстве. В аккаунт сохранятся только выбранная тренировка, её пульс и энергия. Остальные данные здоровья не отправляются.</p>
      <label className="button secondary watch-file"><Upload size={16}/>{processing ? `Разбираем файл… ${progress}%` : "Выбрать ZIP или XML"}<input type="file" accept=".zip,.xml" disabled={busy} onChange={e=> {
        const file = e.target.files?.[0]; e.target.value=""; if(!file) return;
        worker.current?.terminate(); setProcessing(true); setProgress(0); setError(""); setCandidates(null);
        const next = new Worker(new URL("../services/appleHealth.worker.ts",import.meta.url),{type:"module"}); worker.current=next;
        next.onmessage = event => {
          if(event.data.progress !== undefined) setProgress(event.data.progress);
          else { setProcessing(false); if(event.data.error) setError(event.data.error); else setCandidates(event.data.candidates); next.terminate(); }
        };
        next.onerror = ()=> { setProcessing(false); setError("Не удалось разобрать файл. Попробуй export.xml вместо ZIP."); next.terminate(); };
        next.postMessage({file,date:workout.date,timeZone:workout.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone});
      }}/></label>
      {processing && <button className="text-button" onClick={()=>{worker.current?.terminate();setProcessing(false);setCandidates(null);}}>Отменить</button>}
      {candidates?.length === 0 && <p role="status" className="tiny">В экспорте нет силовой тренировки за этот день. Проверь дату в журнале и дождись синхронизации часов с iPhone.</p>}
      {candidates?.map(c=><button className="health-candidate" disabled={busy} key={c.key} onClick={()=> {
        const {key:_key,durationMinutes:_duration,...summary}=c; void save(summary);
      }}><Watch size={18}/><span><b>{new Date(c.startedAt).toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit",timeZone:workout.timeZone})} · {Math.round(c.durationMinutes)} мин</b><small>{c.sourceName} · {c.caloriesKcal !== undefined ? `${fmt(c.caloriesKcal)} ккал` : "энергия не указана"} · {c.heartRateAverage ? `${fmt(c.heartRateAverage)} уд/мин` : "пульс не указан"}</small></span><span>Добавить</span></button>)}
    </details>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {conflict && <button className="button secondary" onClick={()=>{onSaved(conflict);setConflict(null);setError("");}}>Загрузить актуальную тренировку</button>}
  </section>;
}
