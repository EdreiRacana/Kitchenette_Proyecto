// Reusable, theme-aware UI primitives for the Sales module.

import { useEffect } from "react";
import type { CSSProperties, ReactNode, ChangeEvent } from "react";
import { X } from "lucide-react";
import type { Tokens } from "./theme";

export function Spinner({ tk, size = 18 }: { tk: Tokens; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, display: "inline-block",
        border: `2px solid ${tk.border}`, borderTopColor: tk.accent,
        borderRadius: "50%", animation: "kt-spin 0.7s linear infinite",
      }}
    />
  );
}

export function Badge({ tk, bg, color, border, children }: {
  tk: Tokens; bg: string; color: string; border: string; children: ReactNode;
}) {
  void tk;
  return (
    <span style={{
      background: bg, color, border: `1px solid ${border}`, borderRadius: 20,
      padding: "3px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "subtle" | "success";

export function Button({
  tk, children, onClick, variant = "primary", icon, disabled, full, type = "button", title,
}: {
  tk: Tokens; children?: ReactNode; onClick?: () => void; variant?: BtnVariant;
  icon?: ReactNode; disabled?: boolean; full?: boolean; type?: "button" | "submit"; title?: string;
}) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "9px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
    width: full ? "100%" : undefined, transition: "filter .15s, background .15s",
    border: "1px solid transparent", whiteSpace: "nowrap",
  };
  const styles: Record<BtnVariant, CSSProperties> = {
    primary: { background: tk.accent, color: "#06122B" },
    success: { background: tk.good, color: "#06231A" },
    danger: { background: "transparent", color: tk.bad, borderColor: tk.border },
    ghost: { background: "transparent", color: tk.textMid, borderColor: tk.border },
    subtle: { background: tk.panel3, color: tk.textHi },
  };
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      style={{ ...base, ...styles[variant] }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(1.1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}>
      {icon}{children}
    </button>
  );
}

export function IconButton({ tk, onClick, children, title }: {
  tk: Tokens; onClick?: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button title={title} onClick={onClick} style={{
      background: "transparent", border: "none", cursor: "pointer", color: tk.textLo,
      display: "flex", alignItems: "center", padding: 4, borderRadius: 6,
    }}
      onMouseEnter={(e) => (e.currentTarget.style.color = tk.textHi)}
      onMouseLeave={(e) => (e.currentTarget.style.color = tk.textLo)}>
      {children}
    </button>
  );
}

export function Field({ tk, label, children, hint }: {
  tk: Tokens; label: string; children: ReactNode; hint?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: tk.textLo }}>{hint}</span>}
    </label>
  );
}

const inputStyle = (tk: Tokens): CSSProperties => ({
  width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
  background: tk.inputBg, color: tk.textHi, fontSize: 14, boxSizing: "border-box", outline: "none",
});

export function TextInput({ tk, value, onChange, placeholder, type = "text" }: {
  tk: Tokens; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      style={inputStyle(tk)}
      onFocus={(e) => (e.currentTarget.style.borderColor = tk.accent)}
      onBlur={(e) => (e.currentTarget.style.borderColor = tk.border)} />
  );
}

export function NumberInput({ tk, value, onChange, min = 0, step = 0.01 }: {
  tk: Tokens; value: number; onChange: (v: number) => void; min?: number; step?: number;
}) {
  return (
    <input type="number" min={min} step={step} value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      style={inputStyle(tk)}
      onFocus={(e) => (e.currentTarget.style.borderColor = tk.accent)}
      onBlur={(e) => (e.currentTarget.style.borderColor = tk.border)} />
  );
}

export function Select({ tk, value, onChange, options, placeholder }: {
  tk: Tokens; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle(tk), cursor: "pointer" }}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function EmptyState({ tk, icon, title, hint }: {
  tk: Tokens; icon?: ReactNode; title: string; hint?: string;
}) {
  return (
    <div style={{ textAlign: "center", padding: "48px 16px", color: tk.textLo }}>
      {icon && <div style={{ marginBottom: 12, opacity: 0.6, display: "flex", justifyContent: "center" }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 600, color: tk.textMid, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 13 }}>{hint}</div>}
    </div>
  );
}

// `confirmClose` (opcional): si se pasa, se llama cuando el usuario intenta cerrar
// por clic-afuera o tecla Escape. Si devuelve false, el cierre se cancela.
// Los modales que NO la pasen mantienen el comportamiento anterior (cierran siempre).
export function Modal({ tk, open, onClose, title, children, footer, width = 640, confirmClose }: {
  tk: Tokens; open: boolean; onClose: () => void; title: string;
  children: ReactNode; footer?: ReactNode; width?: number;
  confirmClose?: () => boolean;
}) {
  const tryClose = () => {
    if (confirmClose && !confirmClose()) return; // cierre cancelado por el formulario
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") tryClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, confirmClose]);

  if (!open) return null;
  return (
    <div onClick={tryClose} style={{
      position: "fixed", inset: 0, background: "rgba(3,8,22,0.7)", zIndex: 60,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "40px 16px", overflowY: "auto",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 16,
        width, maxWidth: "100%", minWidth: 0, boxSizing: "border-box", boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 80px)", overflowX: "hidden",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "18px 22px", borderBottom: `1px solid ${tk.border}`,
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: tk.textHi }}>{title}</span>
          <IconButton tk={tk} onClick={tryClose} title="Cerrar"><X size={20} /></IconButton>
        </div>
        <div style={{ padding: 22, overflowY: "auto" }}>{children}</div>
        {footer && (
          <div style={{
            padding: "16px 22px", borderTop: `1px solid ${tk.border}`,
            display: "flex", gap: 10, justifyContent: "flex-end",
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Spinkeyframes() {
  return <style>{`@keyframes kt-spin{to{transform:rotate(360deg)}}`}</style>;
}
