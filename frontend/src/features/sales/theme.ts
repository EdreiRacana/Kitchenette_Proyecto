// Theme adapter + i18n + formatting helpers.
// The host App passes a theme object `t` whose keys differ between builds
// (good/nova/bad vs success/accent/danger). resolveTheme() normalizes both,
// always returning a complete token set so the module never crashes on a
// missing color.

import type { OrderStatus } from "./types";

export interface Tokens {
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
  border: string;
  inputBg: string;
  textHi: string;
  textMid: string;
  textLo: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
}

type AnyTheme = Record<string, unknown> | null | undefined;

function pick(t: AnyTheme, keys: string[], fallback: string): string {
  if (t) {
    for (const k of keys) {
      const v = (t as Record<string, unknown>)[k];
      if (typeof v === "string" && v.length) return v;
    }
  }
  return fallback;
}

export function resolveTheme(t: AnyTheme): Tokens {
  return {
    bg: pick(t, ["bg", "background", "appBg"], "#070E24"),
    panel: pick(t, ["panel", "surface", "card"], "#0E1838"),
    panel2: pick(t, ["panel2", "surfaceAlt", "surface2"], "#131F44"),
    panel3: pick(t, ["panel3", "surface3", "hover"], "#1A2856"),
    border: pick(t, ["border", "divider"], "#1E2E5C"),
    inputBg: pick(t, ["inputBg", "bg", "background"], "#0A1430"),
    textHi: pick(t, ["textHi", "text", "textPrimary"], "#F2F6FF"),
    textMid: pick(t, ["textMid", "textSecondary"], "#AFBEDF"),
    textLo: pick(t, ["textLo", "textMuted", "textTertiary"], "#7C9AD0"),
    accent: pick(t, ["nova", "accent", "primary"], "#33B2F5"),
    good: pick(t, ["good", "success"], "#34D399"),
    warn: pick(t, ["warn", "warning"], "#FBBF24"),
    bad: pick(t, ["bad", "danger", "error"], "#F87171"),
  };
}

// i18n: host may pass `s` as a function s(key) or an object map, or nothing.
export type Translator = (key: string, fallback: string) => string;

export function makeTr(s: unknown): Translator {
  return (key: string, fallback: string) => {
    if (typeof s === "function") {
      try {
        const out = (s as (k: string) => unknown)(key);
        if (typeof out === "string" && out.length && out !== key) return out;
      } catch { /* ignore */ }
    } else if (s && typeof s === "object") {
      const out = (s as Record<string, unknown>)[key];
      if (typeof out === "string" && out.length) return out;
    }
    return fallback;
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function money(n: number | null | undefined, currency = "MXN"): string {
  const v = typeof n === "number" ? n : 0;
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(v);
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// ── Status presentation ────────────────────────────────────────────────────

export interface StatusMeta { label: string; key: "good" | "warn" | "accent" | "bad" | "muted"; }

const STATUS_MAP: Record<string, StatusMeta> = {
  draft: { label: "Borrador", key: "muted" },
  pending: { label: "Pendiente", key: "warn" },
  partial: { label: "Parcial", key: "accent" },
  paid: { label: "Pagado", key: "good" },
  cancelled: { label: "Cancelado", key: "bad" },
  sent: { label: "Enviada", key: "accent" },
  accepted: { label: "Aceptada", key: "good" },
  rejected: { label: "Rechazada", key: "bad" },
  expired: { label: "Expirada", key: "muted" },
  converted: { label: "Convertida", key: "good" },
};

export function statusMeta(status: OrderStatus | string): StatusMeta {
  return STATUS_MAP[status] ?? { label: status, key: "muted" };
}

export function statusColors(tk: Tokens, status: string): { bg: string; text: string; border: string } {
  const meta = statusMeta(status);
  const c =
    meta.key === "good" ? tk.good :
    meta.key === "warn" ? tk.warn :
    meta.key === "accent" ? tk.accent :
    meta.key === "bad" ? tk.bad : tk.textLo;
  return { bg: c + "22", text: c, border: c + "44" };
}

export const ORDER_PIPELINE: OrderStatus[] = ["draft", "pending", "partial", "paid"];

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "credit", label: "Crédito" },
  { value: "check", label: "Cheque" },
  { value: "other", label: "Otro" },
];

export const CHANNELS: { value: string; label: string }[] = [
  { value: "mostrador", label: "Mostrador" },
  { value: "telefono", label: "Teléfono" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "web", label: "Web" },
  { value: "otro", label: "Otro" },
];

export function paymentLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;
}
