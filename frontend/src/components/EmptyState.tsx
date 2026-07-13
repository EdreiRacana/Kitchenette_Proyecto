// EmptyState.tsx — Componente compartido para estados vacíos elegantes.
// Uso: <EmptyState t={t} icon={Package} title="Sin productos" subtitle="Comienza agregando uno" action={{ label: "Agregar", onClick: fn }} />

import type { ComponentType } from "react";

export interface EmptyStateProps {
  t: any;
  icon?: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void; icon?: ComponentType<{ size?: number }> };
  compact?: boolean;
}

export default function EmptyState({ t, icon: Icon, title, subtitle, action, compact }: EmptyStateProps) {
  const pad = compact ? "24px 20px" : "48px 24px";
  const iconSize = compact ? 28 : 40;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 8, padding: pad, textAlign: "center", color: t.textLo,
    }}>
      {Icon && (
        <div style={{
          background: t.panel2, borderRadius: 16, padding: compact ? 12 : 18,
          border: `1px solid ${t.border}`, marginBottom: 4, opacity: 0.85,
        }}>
          <Icon size={iconSize} color={t.textLo} strokeWidth={1.5} />
        </div>
      )}
      <div style={{ fontSize: compact ? 14 : 16, fontWeight: 700, color: t.textMid }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12.5, color: t.textLo, maxWidth: 360, lineHeight: 1.5 }}>{subtitle}</div>
      )}
      {action && (
        <button onClick={action.onClick}
          style={{
            marginTop: 12, display: "flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 10, border: "none",
            background: `linear-gradient(135deg, ${t.nova}, ${t.navy || "#1e40af"})`,
            color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
          }}>
          {action.icon && <action.icon size={14} />}
          {action.label}
        </button>
      )}
    </div>
  );
}
