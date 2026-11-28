import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  JOINT_ZONES,
  JOINT_ZONE_LABELS,
  type JointZone,
  type PainSeverity,
} from "../domain/BiomechanicsCatalogV3";
import {
  JointGuardEngine,
  JointPainStore,
  OPTIONAL_WARMUP_PROTOCOLS,
  type JointPainLog,
} from "../domain/JointGuardEngine";

const SEVERITY_OPTIONS: ReadonlyArray<{ val: PainSeverity; short: string; title: string }> = [
  { val: 0, short: "Нет", title: "Нет боли (0/10)" },
  { val: 1, short: "1–3", title: "Лёгкий дискомфорт (1–3/10, проходит до утра)" },
  { val: 2, short: "4–5", title: "Умеренная боль (4–5/10 или держится >24 ч)" },
  { val: 3, short: "6+", title: "Острая боль (6–10/10) — стоп нагрузки" },
];

type Props = {
  accountId?: string;
  onLogsChange?: (logs: JointPainLog[]) => void;
};

/**
 * Компактный чек-ин суставов и сухожилий (JointGuardEngine v3) на экране «Сегодня».
 * В спокойном состоянии свёрнут в 1 строку; при отметке боли сразу активирует автозамены и S5_pain.
 */
export default function JointGuardCard({ accountId, onLogsChange }: Props) {
  const [logs, setLogs] = useState<JointPainLog[]>(() => JointPainStore.read(undefined, Date.now(), accountId));
  useEffect(() => {
    setLogs(JointPainStore.read(undefined, Date.now(), accountId));
  }, [accountId]);
  const nowMs = Date.now();
  const active = useMemo(() => JointGuardEngine.activeZoneSeverities(logs, nowMs), [logs, nowMs]);
  const activeCount = JOINT_ZONES.filter((z) => active[z] > 0).length;
  const maxSev = Math.max(0, ...JOINT_ZONES.map((z) => active[z])) as PainSeverity;
  const [expanded, setExpanded] = useState(() => activeCount > 0);

  const hasRedFlag = maxSev >= 3;

  const warmupHints = useMemo(() => {
    const out: Array<(typeof OPTIONAL_WARMUP_PROTOCOLS)[keyof typeof OPTIONAL_WARMUP_PROTOCOLS]> = [];
    if (active.lumbar === 1 || active.lumbar === 2) out.push(OPTIONAL_WARMUP_PROTOCOLS.mcgill_big_3);
    if (active.knee_patellar === 1 || active.knee_patellar === 2) out.push(OPTIONAL_WARMUP_PROTOCOLS.iso_patellar_5x45);
    if (active.shoulder_anterior === 1 || active.shoulder_anterior === 2) out.push(OPTIONAL_WARMUP_PROTOCOLS.scapular_er_iso);
    if (active.elbow === 1 || active.elbow === 2) out.push(OPTIONAL_WARMUP_PROTOCOLS.subthreshold_elbow_iso);
    return out;
  }, [active]);

  const setZone = (zone: JointZone, severity: PainSeverity, redFlag = false) => {
    const next = JointPainStore.setZoneStatus(zone, severity, redFlag, Date.now(), undefined, accountId);
    setLogs(next);
    onLogsChange?.(next);
  };

  return (
    <section
      className={`jg-card${maxSev >= 3 ? " is-red" : maxSev === 2 ? " is-amber" : maxSev === 1 ? " is-green" : ""}`}
      aria-label="Чек-ин суставов и сухожилий"
    >
      <button
        type="button"
        className="jg-toggle-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="jg-head-left">
          {maxSev >= 2 ? (
            <ShieldAlert size={16} aria-hidden="true" />
          ) : (
            <ShieldCheck size={16} aria-hidden="true" />
          )}
          <div className="jg-head-copy">
            <strong>
              {activeCount === 0
                ? "Суставы · всё чисто"
                : `Защита суставов · зон под контролем: ${activeCount}`}
            </strong>
            <small>
              {activeCount === 0
                ? "Если что-то ноет — отметь зону для безопасных замен в тренировке"
                : JOINT_ZONES.filter((z) => active[z] > 0)
                    .map((z) => `${JOINT_ZONE_LABELS[z]} (${active[z] === 3 ? "острая" : active[z] === 2 ? "4–5/10" : "1–3/10"})`)
                    .join(" · ")}
            </small>
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`jg-chevron${expanded ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div className="jg-body">
          {hasRedFlag ? (
            <div className="jg-red-banner" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                Красная зона: нагрузка на проблемный сегмент заблокирована. При ночной, отдающей или острой боли рекомендуется очный осмотр спортивного врача.
              </span>
            </div>
          ) : null}

          <div className="jg-zones-list">
            {JOINT_ZONES.map((zone) => {
              const cur = active[zone];
              return (
                <div className="jg-zone-row" key={zone}>
                  <span className="jg-zone-name">{JOINT_ZONE_LABELS[zone]}</span>
                  <div className="jg-sev-pills" role="group" aria-label={`Боль: ${JOINT_ZONE_LABELS[zone]}`}>
                    {SEVERITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        title={opt.title}
                        aria-pressed={cur === opt.val}
                        className={`jg-sev-btn is-sev-${opt.val}${cur === opt.val ? " is-active" : ""}`}
                        onClick={() => setZone(zone, opt.val, opt.val === 3)}
                      >
                        {opt.short}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {warmupHints.length > 0 ? (
            <div className="jg-warmup-list">
              {warmupHints.map((proto) => (
                <div className="jg-warmup-chip" key={proto.id}>
                  <strong>Опциональная разминка · {proto.title}</strong>
                  <span>{proto.prescription}</span>
                  <small>{proto.note}</small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
