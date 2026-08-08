// Núcleo de líquido (medidor de nivel animado).
// Extraído de BIModule (mismo instrumento que la esfera de "Meta vs real"
// del Tablero antiguo). Reutilizable desde cualquier módulo.

import type { CSSProperties } from "react";

type Tokens = any;

interface Props {
  pct: number;
  t: Tokens;
  sub?: string;
  hue?: "green" | "blue";
  style?: CSSProperties;
}

export default function LiquidCore({ pct, t, sub, hue = "green", style }: Props) {
  const W = 200, H = 204, cx = 100, cy = 100, r = 78;
  const fillPct = Math.max(0, Math.min(100, Math.round(pct)));
  const bot = cy + r;
  const fillTopY = bot - (2 * r) * fillPct / 100;

  const MTX = hue === "blue"
    ? { dark: "#0B4A78", mid: "#1E86CC", bright: "#33B2F5", surf: "#8CEEFF" }
    : { dark: "#067A2E", mid: "#12D954", bright: "#5BFF87", surf: "#8AFFB0" };

  const isLight = ((): boolean => {
    const h = String(t.base || t.panel || "").replace("#", "");
    if (h.length < 6) return false;
    return (parseInt(h.slice(0, 2), 16) * 299
            + parseInt(h.slice(2, 4), 16) * 587
            + parseInt(h.slice(4, 6), 16) * 114) / 1000 > 140;
  })();

  const waveFill = (amp: number, wl: number) => {
    let d = `M ${-2 * wl} ${fillTopY.toFixed(1)}`;
    for (let x = -2 * wl; x <= W + 2 * wl; x += 5) {
      d += ` L ${x} ${(fillTopY + amp * Math.sin((x / wl) * 2 * Math.PI)).toFixed(1)}`;
    }
    return d + ` L ${W + 2 * wl} ${bot + 24} L ${-2 * wl} ${bot + 24} Z`;
  };
  const waveLine = (amp: number, wl: number) => {
    let d = `M ${-2 * wl} ${(fillTopY + amp * Math.sin((-2 * wl / wl) * 2 * Math.PI)).toFixed(1)}`;
    for (let x = -2 * wl; x <= W + 2 * wl; x += 5) {
      d += ` L ${x} ${(fillTopY + amp * Math.sin((x / wl) * 2 * Math.PI)).toFixed(1)}`;
    }
    return d;
  };

  const gridYs = [38, 54, 70, 86, 102, 118, 134, 150, 166];
  const bubbles = [
    { x: 76, r: 2.4, dur: 3.6, begin: 0 },
    { x: 112, r: 1.7, dur: 4.3, begin: 0.9 },
    { x: 94, r: 3, dur: 3.9, begin: 1.7 },
    { x: 128, r: 1.9, dur: 4.7, begin: 2.4 },
    { x: 66, r: 1.5, dur: 3.2, begin: 1.2 },
  ];
  const hasLiquid = fillPct > 0.5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%"
      style={{ maxWidth: 210, height: "auto", display: "block", ...style }}>
      <defs>
        <clipPath id="lcClip"><circle cx={cx} cy={cy} r={r - 3} /></clipPath>
        <linearGradient id="lcLiquid" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={MTX.dark} />
          <stop offset="70%" stopColor={MTX.mid} />
          <stop offset="100%" stopColor={MTX.bright} />
        </linearGradient>
        <radialGradient id="lcVign" cx="50%" cy="42%" r="62%">
          <stop offset="58%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity={isLight ? "0.06" : "0.38"} />
        </radialGradient>
        <filter id="lcGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={t.panel3 || t.panel2 || "#0f1520"} opacity="0.5" />
      <g clipPath="url(#lcClip)">
        {gridYs.map((y) => (
          <line key={y} x1={cx - r} x2={cx + r} y1={y} y2={y}
            stroke={t.gridLine || t.border || "rgba(255,255,255,0.08)"}
            strokeWidth="1" opacity={isLight ? "0.7" : "0.5"} />
        ))}
        {hasLiquid && (
          <>
            <g opacity="0.3">
              <animateTransform attributeName="transform" type="translate"
                from="0 0" to="-100 0" dur="5.5s" repeatCount="indefinite" />
              <path d={waveFill(6, 100)} fill={MTX.mid} />
            </g>
            <g>
              <animateTransform attributeName="transform" type="translate"
                from="0 0" to="-70 0" dur="3.2s" repeatCount="indefinite" />
              <path d={waveFill(5, 70)} fill="url(#lcLiquid)" opacity="0.92" />
              <path d={waveLine(5, 70)} fill="none" stroke={MTX.surf}
                strokeWidth="2" filter="url(#lcGlow)" />
            </g>
            {bubbles.map((b, i) => (
              <circle key={i} cx={b.x} cy={bot - 6} r={b.r} fill={MTX.surf} opacity="0">
                <animate attributeName="cy" from={bot - 6} to={fillTopY + 4}
                  dur={`${b.dur}s`} begin={`${b.begin}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.55;0"
                  dur={`${b.dur}s`} begin={`${b.begin}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </>
        )}
        <rect x="0" y="0" width={W} height={H} fill="url(#lcVign)" />
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={MTX.bright}
        strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r + 4} fill="none"
        stroke={t.border || "rgba(255,255,255,0.15)"} strokeWidth="1" />
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 - 90) * Math.PI / 180;
        const major = i % 9 === 0;
        const x1 = cx + (r + 4) * Math.cos(a), y1 = cy + (r + 4) * Math.sin(a);
        const x2 = cx + (r + (major ? 11 : 7)) * Math.cos(a);
        const y2 = cy + (r + (major ? 11 : 7)) * Math.sin(a);
        return <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)}
          x2={x2.toFixed(1)} y2={y2.toFixed(1)}
          stroke={major ? MTX.bright : (t.textLo || "#666")}
          strokeWidth="1" opacity={major ? "0.85" : "0.35"} />;
      })}
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize="42" fontWeight="800"
        fill={t.textHi || "#fff"} style={{ letterSpacing: "-1px" }}>
        {fillPct}%
      </text>
      {sub && (
        <text x={cx} y={cy + 17} textAnchor="middle" fontSize="9.5" fontWeight="600"
          fill={t.textMid || "#aaa"} letterSpacing="1.4">
          {sub}
        </text>
      )}
    </svg>
  );
}
