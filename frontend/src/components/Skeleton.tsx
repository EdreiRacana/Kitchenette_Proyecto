// Skeleton.tsx — Placeholders animados para estados de carga.
// Uso: <Skeleton t={t} width="60%" height={14} /> o <SkeletonRow t={t} cols={5} />

export interface SkeletonProps {
  t: any;
  width?: number | string;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ t, width = "100%", height = 12, radius = 6, style }: SkeletonProps) {
  return (
    <span style={{
      display: "inline-block", width, height, borderRadius: radius,
      background: `linear-gradient(90deg, ${t.panel3} 0%, ${t.panel2} 50%, ${t.panel3} 100%)`,
      backgroundSize: "200% 100%",
      animation: "sthenova-shimmer 1.4s ease-in-out infinite",
      ...style,
    }} />
  );
}

export function SkeletonRow({ t, cols = 5 }: { t: any; cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <Skeleton t={t} width={i === 0 ? "70%" : "45%"} height={12} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard({ t }: { t: any }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 16 }}>
      <Skeleton t={t} width={100} height={11} style={{ marginBottom: 10 }} />
      <Skeleton t={t} width="60%" height={22} style={{ marginBottom: 6 }} />
      <Skeleton t={t} width="40%" height={10} />
    </div>
  );
}

// Estilos globales para el shimmer — inyectados una vez
if (typeof document !== "undefined" && !document.getElementById("sthenova-skeleton-styles")) {
  const s = document.createElement("style");
  s.id = "sthenova-skeleton-styles";
  s.innerHTML = `@keyframes sthenova-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`;
  document.head.appendChild(s);
}
