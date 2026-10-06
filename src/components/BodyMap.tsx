import { useState } from 'react';
import type { Muscle, MuscleLoad } from '../lib/model';

// A functional schematic: each colored region represents logged muscle load.
const front: { muscle: Muscle; d: string }[] = [
  { muscle: 'shoulders', d: 'M65 73 Q48 72 43 91 L57 103 72 83Z M135 73 Q152 72 157 91 L143 103 128 83Z' },
  { muscle: 'chest', d: 'M74 76 L98 80 97 109 Q81 113 66 99Z M126 76 L102 80 103 109 Q119 113 134 99Z' },
  { muscle: 'biceps', d: 'M43 94 L56 106 49 132 Q37 137 34 126Z M157 94 L144 106 151 132 Q163 137 166 126Z' },
  { muscle: 'core', d: 'M78 114 L97 115 97 154 84 157Z M122 114 L103 115 103 154 116 157Z' },
  { muscle: 'quads', d: 'M79 178 L97 180 93 227 Q84 237 73 228 L70 197Z M121 178 L103 180 107 227 Q116 237 127 228 L130 197Z' },
  { muscle: 'calves', d: 'M74 244 L90 244 86 279 76 285 71 265Z M126 244 L110 244 114 279 124 285 129 265Z' },
];
const back: { muscle: Muscle; d: string }[] = [
  { muscle: 'shoulders', d: 'M64 73 Q48 73 43 91 L57 103 73 82Z M136 73 Q152 73 157 91 L143 103 127 82Z' },
  { muscle: 'back', d: 'M76 73 L97 70 97 153 84 156 67 108Z M124 73 L103 70 103 153 116 156 133 108Z' },
  { muscle: 'triceps', d: 'M43 94 L56 106 49 134 Q38 137 34 126Z M157 94 L144 106 151 134 Q162 137 166 126Z' },
  { muscle: 'glutes', d: 'M80 159 L97 158 97 186 Q82 192 72 182Z M120 159 L103 158 103 186 Q118 192 128 182Z' },
  { muscle: 'hamstrings', d: 'M73 190 L96 191 93 229 Q84 237 74 229 L70 206Z M127 190 L104 191 107 229 Q116 237 126 229 L130 206Z' },
  { muscle: 'calves', d: 'M74 244 L91 244 88 272 77 286 71 267Z M126 244 L109 244 112 272 123 286 129 267Z' },
];
const outline = 'M86 63 L86 56 Q71 49 77 30 Q80 14 100 14 Q120 14 123 30 Q129 49 114 56 L114 63 139 72 Q157 77 162 100 L179 146 181 161 173 164 166 151 159 139 146 116 137 114 127 157 136 186 Q140 206 129 236 L131 260 128 288 129 302 113 304 106 297 108 283 106 260 101 239 100 200 99 239 94 260 92 283 94 297 87 304 71 302 72 288 69 260 71 236 Q60 206 64 186 L73 157 63 114 54 116 41 139 34 151 27 164 19 161 21 146 38 100 Q43 77 61 72Z';
export const loadColor = (ratio: number) => ratio === 0 ? '#353e37' : ratio < 0.5 ? '#62754e' : ratio < 0.8 ? '#96b965' : ratio <= 1.25 ? '#c8f36b' : '#dba76c';

export default function BodyMap({ loads, selected, onSelect }: { loads: MuscleLoad[]; selected: Muscle | null; onSelect: (m: Muscle) => void }) {
  const [side, setSide] = useState<'both' | 'front' | 'back'>('both');
  return <div className="body-map">
    <div className="map-view-control" aria-label="Вид карты мышц"><button onClick={() => setSide('both')} className={side === 'both' ? 'active' : ''}>Оба вида</button><button onClick={() => setSide('front')} className={side === 'front' ? 'active' : ''}>Спереди</button><button onClick={() => setSide('back')} className={side === 'back' ? 'active' : ''}>Сзади</button></div>
    <div className={`body-figures ${side !== 'both' ? 'single' : ''}`}>
      {(['front', 'back'] as const).filter(s => side === 'both' || side === s).map(s => <div className="body-figure" key={s}>
        <svg viewBox="0 0 200 320" role="img" aria-label={s === 'front' ? 'Карта нагрузки спереди' : 'Карта нагрузки сзади'}>
          <path d={outline} fill="#222a24" stroke="#3a453c" strokeWidth="1.2" />
          {(s === 'front' ? front : back).map(({ muscle, d }, i) => {
            const m = loads.find(l => l.id === muscle)!;
            return <path key={i} d={d} fill={loadColor(m.ratio)} stroke={selected === muscle ? '#fff' : '#151b16'} strokeWidth={selected === muscle ? 2 : 1.4} className="muscle-region" role="button" tabIndex={0} aria-label={`${m.name}: ${m.total} из ${m.goal} подходов`} aria-pressed={selected === muscle} onClick={() => onSelect(muscle)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(muscle); } }}><title>{m.name}: {m.total} / {m.goal}</title></path>;
          })}
          <path d="M85 39 Q100 44 115 39 M98 66 L102 66" stroke="#3a453c" strokeWidth="1" fill="none" />
        </svg><span>{s === 'front' ? 'СПЕРЕДИ' : 'СЗАДИ'}</span>
      </div>)}
    </div>
    <div className="map-legend"><span><i style={{ background: '#353e37' }} />Нет нагрузки</span><span><i style={{ background: '#96b965' }} />Мало</span><span><i style={{ background: '#c8f36b' }} />Цель</span><span><i style={{ background: '#dba76c' }} />Выше цели</span></div>
  </div>;
}
