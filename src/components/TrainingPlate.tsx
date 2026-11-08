import { useId } from "react";

/** Decorative original vector artwork: a steel bar and stacked rubber plates. */
export default function TrainingPlate() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="training-plate" viewBox="0 0 600 520" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-rim`} x1="140" y1="100" x2="470" y2="420" gradientUnits="userSpaceOnUse">
          <stop stopColor="#83907a" />
          <stop offset=".17" stopColor="#363f32" />
          <stop offset=".5" stopColor="#111810" />
          <stop offset=".84" stopColor="#48553e" />
          <stop offset="1" stopColor="#20271e" />
        </linearGradient>
        <radialGradient id={`${id}-face`} cx="0" cy="0" r="1" gradientTransform="translate(248 159) rotate(54) scale(346 315)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#434f37" />
          <stop offset=".48" stopColor="#252e21" />
          <stop offset="1" stopColor="#10160f" />
        </radialGradient>
        <linearGradient id={`${id}-steel`} x1="380" y1="227" x2="387" y2="269" gradientUnits="userSpaceOnUse">
          <stop stopColor="#343c35" />
          <stop offset=".28" stopColor="#c0c8b9" />
          <stop offset=".48" stopColor="#eef1e7" />
          <stop offset=".62" stopColor="#777f72" />
          <stop offset="1" stopColor="#29302a" />
        </linearGradient>
      </defs>
      <g opacity=".2" stroke="currentColor">
        <circle cx="307" cy="266" r="230" strokeDasharray="2 13" />
        <path d="M40 266h520M307 24v484" strokeOpacity=".4" />
        <path d="M76 76h24v24M516 76h-24v24M76 456h24v-24M516 456h-24v-24" />
      </g>
      <g transform="rotate(-22 300 270)">
        <ellipse cx="310" cy="443" rx="205" ry="18" fill="#050905" opacity=".55" />
        <rect x="84" y="238" width="460" height="43" rx="7" fill={`url(#${id}-steel)`} />
        <ellipse cx="331" cy="262" rx="152" ry="177" fill="#0c120c" stroke="#3e4937" strokeWidth="3" />
        <ellipse cx="311" cy="257" rx="156" ry="183" fill={`url(#${id}-rim)`} stroke="#6a775e" strokeWidth="1.5" />
        <ellipse cx="291" cy="251" rx="158" ry="185" fill={`url(#${id}-rim)`} stroke="#75846a" strokeWidth="1.5" />
        <ellipse cx="279" cy="249" rx="152" ry="181" fill={`url(#${id}-face)`} stroke="#4b5940" strokeWidth="2" />
        <ellipse cx="279" cy="249" rx="139" ry="167" stroke="#6d7c5b" strokeOpacity=".5" />
        <ellipse cx="279" cy="249" rx="130" ry="156" stroke="#141c12" strokeWidth="4" />
        <path d="M176 139c22-25 52-43 83-50M359 376c-25 26-52 41-82 45" stroke="#a6b68e" strokeOpacity=".3" strokeWidth="2" strokeLinecap="round" />
        <path d="M189 202c-14 14-20 33-20 52s6 38 20 52l19-14c-8-11-12-24-12-38s4-27 12-38zM299 112c-25-4-48 0-70 12l8 25c18-9 33-12 52-9zM300 386c-25 4-48 0-70-12l8-25c18 9 33 12 52 9z" fill="#0b110a" stroke="#46533b" strokeWidth="2" />
        <ellipse cx="279" cy="249" rx="52" ry="62" fill="#20271e" stroke="#4c5a41" strokeWidth="2" />
        <ellipse cx="279" cy="249" rx="31" ry="37" fill={`url(#${id}-rim)`} stroke="#87947b" strokeWidth="5" />
        <ellipse cx="279" cy="249" rx="20" ry="25" fill="#080d08" stroke="#1b2418" strokeWidth="3" />
        <path d="M279 228h233a6 6 0 0 1 6 6v27a6 6 0 0 1-6 6H279z" fill={`url(#${id}-steel)`} />
        <g stroke="#1c241c" strokeOpacity=".45">
          {[438, 444, 450, 456, 462, 468, 474, 480, 486, 492, 498].map((x) => <path key={x} d={`M${x} 231v32`} />)}
        </g>
        <rect x="403" y="224" width="23" height="49" rx="3" fill={`url(#${id}-rim)`} stroke="#8b987e" />
        <text x="339" y="214" textAnchor="middle" transform="rotate(9 339 214)" fill="currentColor" fontFamily="var(--font-display)" fontSize="53" fontWeight="600" letterSpacing="-2">20</text>
        <text x="345" y="233" textAnchor="middle" transform="rotate(9 345 233)" fill="#a6b494" fontFamily="var(--font-body)" fontSize="12" fontWeight="700">КГ</text>
        <text x="275" y="337" textAnchor="middle" fill="#849474" fontFamily="var(--font-display)" fontSize="20" fontWeight="500" letterSpacing="3">ТЯГА</text>
      </g>
    </svg>
  );
}
