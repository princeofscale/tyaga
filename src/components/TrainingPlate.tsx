import { useId } from "react";
import { m } from "motion/react";

/**
 * Оригинальная векторная иллюстрация: олимпийский гриф сбоку с набором блинов
 * 20 · 20 · 10 · 5 · 2,5 кг и замком. Блины «надеваются» один за другим.
 */
const PLATES = [
  { x: 352, w: 48, h: 372, label: "20", size: 27 },
  { x: 404, w: 48, h: 372, label: "20", size: 27 },
  { x: 456, w: 34, h: 284, label: "10", size: 20 },
  { x: 494, w: 26, h: 212, label: "5", size: 16 },
  { x: 524, w: 20, h: 158, label: "2.5", size: 12 },
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;
const CY = 260;

export default function TrainingPlate() {
  const id = useId().replace(/:/g, "");
  const ref = (name: string) => `url(#${id}-${name})`;
  return (
    <svg className="training-plate" viewBox="0 0 600 520" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#323a32" />
          <stop offset=".26" stopColor="#c9d0c1" />
          <stop offset=".46" stopColor="#f3f6ec" />
          <stop offset=".7" stopColor="#7d867a" />
          <stop offset="1" stopColor="#262c26" />
        </linearGradient>
        <linearGradient id={`${id}-rubber`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#141a12" />
          <stop offset=".2" stopColor="#465638" />
          <stop offset=".5" stopColor="#62754f" />
          <stop offset=".8" stopColor="#374630" />
          <stop offset="1" stopColor="#0f140e" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#a9b995" stopOpacity=".55" />
          <stop offset=".18" stopColor="#a9b995" stopOpacity="0" />
          <stop offset=".85" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".4" />
        </linearGradient>
        <radialGradient id={`${id}-floor`} cx=".5" cy=".5" r=".5">
          <stop stopColor="#000" stopOpacity=".6" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Рамка прицела и тень на полу: статичны, задают сцену */}
      <g opacity=".22" stroke="currentColor">
        <path d="M76 70h24v24M524 70h-24v24M76 462h24v-24M524 462h-24v-24" />
      </g>
      <ellipse cx="318" cy="486" rx="250" ry="20" fill={ref("floor")} />

      <g transform={`translate(-38 8) rotate(-13 300 ${CY})`}>
        {/* Гриф: накатка и гладкая часть */}
        <m.g
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <rect x="66" y={CY - 9} width="280" height="18" rx="3" fill={ref("steel")} />
          <g stroke="#161c16" strokeOpacity=".42" strokeWidth="1">
            {Array.from({ length: 27 }, (_, i) => 118 + i * 5).map((x) => (
              <path key={x} d={`M${x} ${CY - 8}l3 16`} />
            ))}
          </g>
          <path d={`M104 ${CY - 9}v18M262 ${CY - 9}v18`} stroke="#10150f" strokeOpacity=".6" strokeWidth="2" />
          <text x="146" y={CY - 14} fill="#8d9c7b" fontFamily="var(--font-display)" fontSize="9" fontWeight="600" letterSpacing="3">
            ТЯГА · 20 КГ
          </text>
        </m.g>

        {/* Втулка под блины */}
        <rect x="340" y={CY - 15} width="256" height="30" rx="4" fill={ref("steel")} />
        <rect x="592" y={CY - 12} width="9" height="24" rx="3" fill="#59635a" />

        {/* Блины */}
        {PLATES.map((p, i) => (
          <m.g
            key={i}
            initial={{ opacity: 0, x: 64 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.65, delay: 0.35 + i * 0.1, ease: EASE }}
          >
            <rect x={p.x} y={CY - p.h / 2} width={p.w} height={p.h} rx={Math.min(11, p.w / 2)} fill={ref("rubber")} stroke="#6d7c5b" strokeOpacity=".55" />
            <rect x={p.x} y={CY - p.h / 2} width={p.w} height={p.h} rx={Math.min(11, p.w / 2)} fill={ref("edge")} />
            <rect x={p.x + 4} y={CY - p.h / 2 + 7} width={p.w - 8} height={p.h - 14} rx={Math.min(8, p.w / 2 - 3)} stroke="#0b100a" strokeOpacity=".55" strokeWidth="1.5" />
            <rect x={p.x} y={CY - 23} width={p.w} height="46" fill="#222a21" stroke="#7d8a70" strokeOpacity=".6" />
            <rect x={p.x} y={CY - 23} width={p.w} height="46" fill={ref("steel")} opacity=".22" />
            <text
              transform={`translate(${p.x + p.w / 2 + p.size * 0.35} ${CY - p.h / 2 + 46}) rotate(90)`}
              fill="currentColor"
              fontFamily="var(--font-display)"
              fontSize={p.size}
              fontWeight="600"
              letterSpacing=".5"
            >
              {p.label}
            </text>
          </m.g>
        ))}

        {/* Замок */}
        <m.g
          initial={{ opacity: 0, x: 26 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.35 + PLATES.length * 0.1, ease: EASE }}
        >
          <rect x="548" y={CY - 31} width="26" height="62" rx="5" fill={ref("steel")} stroke="#8b987e" strokeOpacity=".7" />
          <rect x="554" y={CY - 5} width="14" height="10" rx="2" fill="#10150f" />
          <path d={`M548 ${CY - 18}h26M548 ${CY + 18}h26`} stroke="#10150f" strokeOpacity=".35" />
        </m.g>
      </g>
    </svg>
  );
}
