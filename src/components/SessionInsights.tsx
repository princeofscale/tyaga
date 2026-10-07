import { Flame, Layers3, CheckCircle2 } from "lucide-react";
import { SessionReport } from "../domain/SessionReport";
import { fmt, type Workout, type Settings } from "../lib/model";
export default function SessionInsights({ workout, settings }: { workout: Workout; settings: Settings }) {
  const report = new SessionReport(workout, settings), sets = report.sets, volume = report.volume;
  return <section className="session-insights" aria-label="Итоги тренировки">
    <div className="insights-title"><CheckCircle2 size={20} /><div><h3>Твоя работа за тренировку</h3><p>Разминка тоже остаётся в журнале и общем объёме.</p></div></div>
    <div className="insight-metrics"><div><Layers3 size={17} /><span>Рабочие</span><b>{sets.working}<small>подх.</small></b></div><div><Flame size={17} /><span>Разминка</span><b>{sets.warmup}<small>подх.</small></b></div><div><span>Всего выполнено</span><b>{sets.total}<small>подх.</small></b></div></div>
    <div className="warmup-volume"><div><span>Весь внешний тоннаж</span><b>{fmt(volume.all.total)} кг</b></div><p>Рабочие: {fmt(volume.working.total)} кг · Разминка: {fmt(volume.warmup.total)} кг</p>
      {volume.all.omittedSets > 0 && <p className="tiny">{volume.all.omittedSets} подх. на тренажёрах, с массой тела или неизвестным правилом веса записаны отдельно. Их значения не складываются с килограммами свободных весов.</p>}
    </div>
    {report.muscles.length > 0 && <div className="session-muscle-table"><div className="muscle-table-head"><span>Прямое участие</span><span>Рабочие</span><span>Разминка</span></div>{report.muscles.map(m => <div key={m.id}><span>{m.short}{m.indirect > 0 && <small>Помощь: {m.indirect} рабочих подх.</small>}</span><b>{m.direct || "—"}</b><b className="warmup-value">{m.warmup || "—"}</b></div>)}</div>}
    {report.unmappedSets > 0 && <p className="tiny">Для {report.unmappedSets} записанных подходов разметка мышц ещё не проверена. Они сохраняются в истории и общем количестве.</p>}
    <details className="warmup-science"><summary>Как учитывается разминка</summary><p>Разминка готовит движение и может улучшать последующие подходы. Все выполненные разминочные подходы входят в количество и внешний тоннаж. На карте выше её прямое участие показано отдельно.</p><p>Недельный ориентир по умолчанию считает рабочие подходы. Нет доказанного универсального «процента роста» от разминки. Если подход стал полноценным тяжёлым рабочим, измени его тип и укажи реальный RIR.</p><a href="https://pubmed.ncbi.nlm.nih.gov/39593476/" target="_blank" rel="noreferrer">Viveiros et al., 2024 — исследование разминки</a><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/" target="_blank" rel="noreferrer">Ribeiro et al., 2020 — жим и присед</a></details>
  </section>;
}
