// POSModule.tsx — Punto de venta profesional
// Flujo: seleccionar terminal → abrir turno → vender → arqueo/cerrar
// Pensado para tablet/pantalla táctil pero funciona con teclado + lector.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Store, ShoppingCart, DollarSign, Plus, Minus, Trash2, Search,
  Lock, Unlock, LogIn, LogOut, Printer, RefreshCw, Package, Download,
  Banknote, CreditCard, ArrowLeftRight, Check, X, AlertTriangle,
  Receipt, User, Clock, ChevronRight, History, Scale, Zap, Sparkles,
  Grid3x3, Barcode, Tablet, ShieldCheck,
} from "lucide-react";
import {
  posApi, DENOMINATIONS,
  type POSTerminal, type POSSession, type POSProduct, type POSSaleItem, type SessionSale,
  type PreviousSessionReport, type POSTransactionRow, type SessionListResponse,
} from "./api";
import configService from "../config/service";
import { resolveMediaUrl } from "../../services/api";

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type CartItem = POSSaleItem & { line_total: number };

export default function POSModule({ t }: { t: any }) {
  const [terminals, setTerminals] = useState<POSTerminal[]>([]);
  const [session, setSession] = useState<POSSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [terms, sess] = await Promise.all([
        posApi.listTerminals(),
        posApi.currentSession(),
      ]);
      setTerminals(terms);
      setSession((sess as any).id ? sess as POSSession : null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error al cargar POS");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando POS…</div>;
  if (err) return (
    <div style={{ padding: 40, textAlign: "center", color: t.bad }}>
      <AlertTriangle size={28} /><div style={{ marginTop: 10 }}>{err}</div>
      <button onClick={load} style={{ marginTop: 14, padding: "8px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer" }}>Reintentar</button>
    </div>
  );

  if (!session) return <SessionSetup t={t} terminals={terminals} onOpened={s => { setSession(s); load(); }} onTerminalsChanged={load} />;

  return <POSFloor t={t} session={session} onClosed={() => { setSession(null); load(); }} />;
}


// ── 1) Vista de setup / apertura de turno ────────────────────────────
function SessionSetup({ t, terminals, onOpened, onTerminalsChanged }: {
  t: any; terminals: POSTerminal[]; onOpened: (s: POSSession) => void; onTerminalsChanged: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [opening, setOpening] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [newTerm, setNewTerm] = useState({ name: "", code: "" });
  const [showPrev, setShowPrev] = useState<{ terminalId?: number; scope: "auto" | "me" | "terminal" } | null>(null);
  const [showArqueos, setShowArqueos] = useState(false);

  const openNow = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const s = await posApi.openSession({ terminal_id: selected, opening_balance: opening, opening_notes: notes || undefined });
      onOpened(s);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al abrir turno");
    } finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: t.textHi }}>Punto de venta</h1>
          <p style={{ color: t.textLo, fontSize: 13, marginTop: 4 }}>Selecciona la caja y captura el fondo inicial para abrir el turno.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setShowArqueos(true)}
            title="Historial de turnos y conciliación de arqueos pendientes"
            style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${t.nova}55`, background: t.nova + "1a", color: t.nova, cursor: "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
            <Scale size={14} /> Arqueos / Conciliación
          </button>
          <button onClick={() => setShowPrev({ terminalId: selected || undefined, scope: selected ? "terminal" : "me" })}
            title="Revisar el reporte del último turno cerrado"
            style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
            <History size={14} /> Revisar turno anterior
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {terminals.map(term => {
          const active = selected === term.id;
          const busy = !!term.open_session_id;
          return (
            <button key={term.id}
              disabled={busy}
              onClick={() => !busy && setSelected(term.id)}
              style={{
                textAlign: "left", padding: 18, borderRadius: 12,
                background: active ? t.nova + "22" : t.panel,
                border: `2px solid ${active ? t.nova : busy ? t.border : t.borderSoft || t.border}`,
                cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.55 : 1,
                position: "relative",
              }}>
              <Store size={22} color={active ? t.nova : t.textMid} />
              <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, color: t.textHi }}>{term.name}</div>
              {term.code && <div style={{ fontSize: 11, color: t.textLo }}>{term.code}</div>}
              {term.warehouse_name && <div style={{ fontSize: 11, color: t.textLo, marginTop: 4 }}>📦 {term.warehouse_name}</div>}
              {busy && (
                <div style={{ marginTop: 8, fontSize: 11, color: t.warn, fontWeight: 700 }}>
                  🔒 Turno abierto por {term.open_cashier_name || "otro cajero"}
                </div>
              )}
            </button>
          );
        })}
        <button onClick={() => setCreatingTerminal(true)}
          style={{ padding: 18, borderRadius: 12, border: `2px dashed ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 13 }}>
          <Plus size={20} style={{ display: "block", margin: "0 auto 8px" }} />
          Nueva caja
        </button>
      </div>

      {selected && (
        <div style={{ marginTop: 28, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 15, color: t.textHi, fontWeight: 700, marginBottom: 14 }}>Apertura de turno</div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Fondo inicial</label>
              <div style={{ position: "relative", marginTop: 4 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textLo }}>$</span>
                <input type="number" step={0.01} value={opening} onChange={e => setOpening(parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "10px 14px 10px 26px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Notas (opcional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej. Fondo dejado del turno anterior"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14, marginTop: 4 }} />
            </div>
          </div>
          <button onClick={openNow} disabled={saving} style={{ marginTop: 14, padding: "12px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Unlock size={16} /> {saving ? "Abriendo…" : "Abrir turno"}
          </button>
        </div>
      )}

      {showPrev && (
        <PreviousSessionDrawer t={t}
          terminalId={showPrev.terminalId}
          scope={showPrev.scope}
          onClose={() => setShowPrev(null)}
        />
      )}

      {showArqueos && <ReconciliationPanel t={t} onClose={() => setShowArqueos(false)} />}

      {creatingTerminal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setCreatingTerminal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: "100%", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 24 }}>
            <h3 style={{ margin: 0, fontSize: 17, color: t.textHi }}>Nueva caja registradora</h3>
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, color: t.textLo }}>Nombre *</label>
              <input value={newTerm.name} onChange={e => setNewTerm(f => ({ ...f, name: e.target.value }))} placeholder="Caja 1"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14, marginTop: 4 }} />
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 12, color: t.textLo }}>Código corto</label>
              <input value={newTerm.code} onChange={e => setNewTerm(f => ({ ...f, code: e.target.value }))} placeholder="CJ-01"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14, marginTop: 4 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => setCreatingTerminal(false)} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer" }}>Cancelar</button>
              <button disabled={!newTerm.name} onClick={async () => {
                try { await posApi.createTerminal(newTerm); setCreatingTerminal(false); setNewTerm({ name: "", code: "" }); onTerminalsChanged(); }
                catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
              }} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontWeight: 700 }}>Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── 2) Sala POS: cart + búsqueda + cobro ────────────────────────────
function POSFloor({ t, session, onClosed }: { t: any; session: POSSession; onClosed: () => void }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<POSProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showCash, setShowCash] = useState<"cash_in" | "cash_out" | null>(null);
  const [lastSale, setLastSale] = useState<any | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showArqueos, setShowArqueos] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [showPrev, setShowPrev] = useState(false);
  const [scanFlash, setScanFlash] = useState<string | null>(null); // feedback breve al escanear
  const [company, setCompany] = useState<{ commercial_name?: string; legal_name?: string; logo_url?: string } | null>(null);
  const [now, setNow] = useState(new Date());
  // Modo tablet autoservicio — la caja voltea la pantalla al cliente para que
  // capture sus datos (factura, contacto) mientras el cajero sigue escaneando.
  const [tabletMode, setTabletMode] = useState(false);
  const [customerData, setCustomerData] = useState<{
    name?: string; email?: string; phone?: string; rfc?: string; wants_invoice?: boolean;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const anyModalOpen = showPay || showClose || !!showCash || !!lastSale || showHistory || showPrev || tabletMode;

  // Branding: logo y nombre comercial del cliente (para el header premium).
  useEffect(() => {
    configService.getCompanyProfile()
      .then(c => setCompany({ commercial_name: c.commercial_name, legal_name: c.legal_name, logo_url: c.logo_url }))
      .catch(() => setCompany(null));
  }, []);
  // Reloj vivo — pequeño toque profesional que ubica al operador y evita
  // discusiones "¿a qué hora fue?" con el cliente.
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(iv);
  }, []);

  // Autofocus permanente: cuando no hay modal abierto, el input SIEMPRE debe
  // tener el focus. Un escáner de código de barras funciona "escribiendo" en
  // el elemento enfocado, así que si perdemos focus, se pierde el escaneo.
  useEffect(() => {
    if (anyModalOpen) return;
    searchRef.current?.focus();
    const refocus = () => { if (document.activeElement !== searchRef.current) searchRef.current?.focus(); };
    const iv = setInterval(refocus, 800);
    window.addEventListener("click", refocus);
    return () => { clearInterval(iv); window.removeEventListener("click", refocus); };
  }, [anyModalOpen]);

  const addToCart = (p: POSProduct, viaScanner = false) => {
    setCart(prev => {
      const existing = prev.find(it => it.variant_id === p.variant_id);
      if (existing) {
        return prev.map(it => it.variant_id === p.variant_id
          ? { ...it, quantity: it.quantity + 1, line_total: (it.quantity + 1) * it.unit_price }
          : it);
      }
      return [...prev, {
        variant_id: p.variant_id, product_name: p.product_name, sku: p.sku,
        quantity: 1, unit_price: p.unit_price, discount_amount: 0, tax_rate: 16,
        is_service: false, line_total: p.unit_price,
      }];
    });
    if (viaScanner) {
      setScanFlash(p.product_name);
      setTimeout(() => setScanFlash(null), 1200);
    }
    setQuery(""); setResults([]);
    searchRef.current?.focus();
  };

  // Búsqueda con debounce (para auto-suggest al escribir a mano)
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await posApi.searchProducts(query, 20);
        setResults(r);
        // Si sólo hay un resultado exacto por SKU/barcode y viene de un escaneo
        // rápido (>=6 caracteres, típico de barcodes), agregar directamente.
        if (r.length === 1 && (r[0].sku === query.trim() || r[0].barcode === query.trim())) {
          addToCart(r[0], true);
        }
      } catch { setResults([]); } finally { setSearching(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Enter en el input: escáner físico termina con Enter. Si hay 1 resultado,
  // agregar; si hay varios, seleccionar el primero exacto.
  const onSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // Buscar sincrónicamente sin esperar debounce
    try {
      const r = await posApi.searchProducts(q, 5);
      if (r.length === 0) {
        setScanFlash("__notfound__");
        setTimeout(() => setScanFlash(null), 1400);
        return;
      }
      // Priorizar match exacto por SKU o barcode
      const exact = r.find(p => p.sku === q || p.barcode === q);
      const chosen = exact || r[0];
      addToCart(chosen, true);
    } catch {
      setScanFlash("__error__");
      setTimeout(() => setScanFlash(null), 1400);
    }
  };

  const changeQty = (idx: number, delta: number) => {
    setCart(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const q = Math.max(1, it.quantity + delta);
      return { ...it, quantity: q, line_total: q * it.unit_price };
    }));
  };
  const removeLine = (idx: number) => setCart(prev => prev.filter((_, i) => i !== idx));

  const subtotal = cart.reduce((a, it) => a + it.line_total, 0);
  const total = subtotal;

  // Estilos reutilizables
  const brandName = company?.commercial_name || company?.legal_name || "Punto de Venta";
  const logoSrc = resolveMediaUrl(company?.logo_url);
  const totalItems = cart.reduce((a, it) => a + it.quantity, 0);
  const iconBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "8px 12px", borderRadius: 10, border: `1px solid ${t.border}`,
    background: t.panel2, color: t.textMid, fontSize: 12, cursor: "pointer",
    fontWeight: 500, whiteSpace: "nowrap", transition: "background .15s",
  };
  const scanState = scanFlash === "__notfound__" || scanFlash === "__error__" ? "error"
    : scanFlash ? "ok" : "idle";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 90px)", padding: 12, gap: 12 }}>
      {/* ══════════ HEADER PREMIUM ══════════ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: `linear-gradient(135deg, ${t.panel} 0%, ${t.panel2} 100%)`, border: `1px solid ${t.border}`, borderRadius: 14, padding: "10px 18px", gap: 14, flexWrap: "wrap", boxShadow: `0 2px 12px ${t.shadow || "rgba(0,0,0,0.15)"}` }}>
        {/* Izquierda: Marca */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {logoSrc ? (
            <img src={logoSrc} alt="" style={{ height: 40, maxWidth: 100, objectFit: "contain" }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${t.nova}, ${t.navy || t.nova})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 18 }}>
              {brandName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.textHi, letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brandName}</div>
            <div style={{ fontSize: 11, color: t.textLo, display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Store size={11} /> {session.terminal_name}
              </span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <User size={11} /> {session.cashier_name}
              </span>
            </div>
          </div>
        </div>

        {/* Centro: Reloj + fecha */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 16px", borderLeft: `1px solid ${t.border}`, borderRight: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums", letterSpacing: 0.5 }}>
            {now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "capitalize" }}>
            {now.toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "short" })}
          </div>
        </div>

        {/* Derecha: Acciones rápidas */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setShowHistory(true)} title="Historial de ventas del turno"
            style={{ ...iconBtn, background: t.nova + "16", border: `1px solid ${t.nova}44`, color: t.nova, fontWeight: 600 }}>
            <Receipt size={14} /> Ventas
            {historyRefresh > 0 && <span style={{ background: t.nova, color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>{historyRefresh}</span>}
          </button>
          <button onClick={() => setShowPrev(true)} title="Turno anterior" style={iconBtn}>
            <History size={14} /> Anterior
          </button>
          <button onClick={() => setShowArqueos(true)} title="Arqueos y conciliación" style={iconBtn}>
            <Scale size={14} /> Arqueos
          </button>
          <button onClick={() => setShowCash("cash_in")} title="Ingresar fondo de caja" style={iconBtn}>
            <Plus size={14} /> Fondo
          </button>
          <button onClick={() => setShowCash("cash_out")} title="Retiro de caja" style={iconBtn}>
            <Minus size={14} /> Retiro
          </button>
          <button onClick={() => setTabletMode(true)}
            title="Modo tablet — el cliente captura sus datos (contacto / factura)"
            style={{ ...iconBtn, background: "#A78BFA22", border: "1px solid #A78BFA66", color: "#A78BFA", fontWeight: 600 }}>
            <Tablet size={14} /> Autoservicio
            {customerData && <span style={{ background: "#A78BFA", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>✓</span>}
          </button>
          <button onClick={() => setShowClose(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", fontSize: 12.5, cursor: "pointer", fontWeight: 700, boxShadow: `0 2px 8px ${t.warn}55` }}>
            <Lock size={14} /> Cerrar turno
          </button>
        </div>
      </div>

      {/* ══════════ CUERPO: catálogo (izq) + carrito (der) ══════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, flex: 1, minHeight: 0 }}>
        {/* ─── Panel izquierdo: búsqueda + resultados ─── */}
        <div style={{ background: t.panel, borderRadius: 14, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 2px 12px ${t.shadow || "rgba(0,0,0,0.10)"}` }}>
          {/* Buscador gigante con feedback de escáner */}
          <div style={{ padding: 16, borderBottom: `1px solid ${t.border}` }}>
            <div style={{ position: "relative" }}>
              <Barcode size={20} color={scanState === "error" ? t.bad : scanState === "ok" ? t.good : t.nova}
                style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Escanear código o buscar producto…"
                autoFocus autoComplete="off" spellCheck={false}
                style={{
                  width: "100%", padding: "18px 18px 18px 52px", borderRadius: 12,
                  border: `2px solid ${scanState === "error" ? t.bad : scanState === "ok" ? t.good : t.nova + "55"}`,
                  background: t.inputBg, color: t.textHi, fontSize: 17, fontWeight: 500, outline: "none",
                  transition: "border-color .2s, box-shadow .2s",
                  boxShadow: scanState !== "idle" ? `0 0 0 4px ${(scanState === "error" ? t.bad : t.good)}22` : "none",
                  boxSizing: "border-box",
                }} />
              {scanFlash && (
                <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: scanState === "error" ? t.bad : t.good, background: (scanState === "error" ? t.bad : t.good) + "22", padding: "5px 12px", borderRadius: 999, pointerEvents: "none" }}>
                  {scanFlash === "__notfound__" ? <><AlertTriangle size={14} /> No encontrado</>
                    : scanFlash === "__error__" ? <><AlertTriangle size={14} /> Error</>
                    : <><Check size={14} /> {scanFlash.length > 22 ? scanFlash.slice(0, 22) + "…" : scanFlash}</>}
                </div>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: t.textLo, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Zap size={11} color={t.nova} /> Escáner listo
              </span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>Enter para agregar</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>F2 para descuento (próximo)</span>
            </div>
          </div>

          {/* Resultados / vacío */}
          <div style={{ flex: 1, overflowY: "auto", padding: results.length ? 12 : 0 }}>
            {results.length === 0 && !searching && (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, color: t.textLo, gap: 12 }}>
                <div style={{ width: 80, height: 80, borderRadius: 20, background: t.nova + "10", display: "flex", alignItems: "center", justifyContent: "center", border: `2px dashed ${t.nova}44` }}>
                  <Barcode size={40} color={t.nova} style={{ opacity: 0.6 }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.textMid, marginBottom: 4 }}>Listo para vender</div>
                  <div style={{ fontSize: 12.5 }}>Escanea el código de barras o busca por nombre / SKU</div>
                </div>
              </div>
            )}
            {searching && (
              <div style={{ padding: 30, textAlign: "center", color: t.textLo, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <RefreshCw size={14} className="spin" /> Buscando…
              </div>
            )}
            {results.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
                {results.map(p => (
                  <button key={p.variant_id} onClick={() => addToCart(p)}
                    style={{ textAlign: "left", padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, background: t.panel2, cursor: "pointer", transition: "transform .1s, border-color .15s, box-shadow .15s", display: "flex", flexDirection: "column", gap: 6 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = t.nova; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${t.nova}22`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = t.border; (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, lineHeight: 1.3, minHeight: 34 }}>{p.product_name}</div>
                    {p.sku && <div style={{ fontSize: 10.5, color: t.textLo, fontFamily: "monospace", letterSpacing: 0.5 }}>{p.sku}</div>}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                      <div style={{ fontSize: 17, fontWeight: 800, color: t.good, letterSpacing: -0.3 }}>{mxn(p.unit_price)}</div>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: t.nova, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Plus size={16} strokeWidth={3} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Panel derecho: ticket + total + cobrar ─── */}
        <div style={{ background: t.panel, borderRadius: 14, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 2px 12px ${t.shadow || "rgba(0,0,0,0.10)"}` }}>
          {/* Header del ticket */}
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, background: `linear-gradient(135deg, ${t.panel2} 0%, ${t.panel} 100%)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 10, padding: 8 }}>
                <ShoppingCart size={18} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>Ticket en curso</div>
                <div style={{ fontSize: 11, color: t.textLo, marginTop: 1 }}>
                  {totalItems > 0 ? `${totalItems} artículo${totalItems === 1 ? "" : "s"} · ${cart.length} línea${cart.length === 1 ? "" : "s"}` : "Vacío"}
                </div>
                {customerData && (
                  <div style={{ fontSize: 11, color: "#A78BFA", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                    <User size={11} /> {customerData.name || "Cliente"}
                    {customerData.wants_invoice && customerData.rfc ? ` · RFC ${customerData.rfc}` : ""}
                    <button onClick={() => setCustomerData(null)} title="Quitar datos del cliente"
                      style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer", padding: 0, marginLeft: 4 }}>
                      <X size={11} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            {cart.length > 0 && (
              <button onClick={() => { if (confirm("¿Vaciar el ticket?")) setCart([]); }}
                title="Vaciar ticket"
                style={{ background: t.bad + "16", border: `1px solid ${t.bad}44`, color: t.bad, cursor: "pointer", fontSize: 11.5, display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, fontWeight: 600 }}>
                <Trash2 size={12} /> Vaciar
              </button>
            )}
          </div>

          {/* Lista de items */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {cart.length === 0 ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, color: t.textLo, gap: 10 }}>
                <ShoppingCart size={48} style={{ opacity: 0.25 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>Agrega productos para empezar</div>
              </div>
            ) : cart.map((it, i) => (
              <div key={i} style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}44`, display: "flex", alignItems: "center", gap: 10, transition: "background .15s" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = t.panel2 + "88"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.product_name}</div>
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 2, fontFamily: "monospace" }}>{mxn(it.unit_price)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, background: t.panel2, borderRadius: 8, padding: 3 }}>
                  <button onClick={() => changeQty(i, -1)} title="Menos" style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", color: t.textMid, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={14} /></button>
                  <div style={{ minWidth: 26, textAlign: "center", fontSize: 14, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{it.quantity}</div>
                  <button onClick={() => changeQty(i, 1)} title="Más" style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: t.nova + "22", color: t.nova, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={14} /></button>
                </div>
                <div style={{ minWidth: 90, textAlign: "right", fontSize: 14, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(it.line_total)}</div>
                <button onClick={() => removeLine(i)} title="Quitar" style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: "transparent", color: t.textLo, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "color .15s, background .15s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = t.bad; (e.currentTarget as HTMLElement).style.background = t.bad + "22"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = t.textLo; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Totales + Cobrar */}
          <div style={{ padding: 18, borderTop: `1px solid ${t.border}`, background: `linear-gradient(135deg, ${t.panel2} 0%, ${t.panel} 100%)` }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.textMid, marginBottom: 8 }}>
              <span>Subtotal</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{mxn(subtotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderTop: `1px solid ${t.border}` }}>
              <span style={{ fontSize: 14, color: t.textMid, fontWeight: 600, letterSpacing: 0.5 }}>TOTAL</span>
              <span style={{ fontSize: 32, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums", letterSpacing: -1 }}>{mxn(total)}</span>
            </div>
            <button disabled={cart.length === 0} onClick={() => setShowPay(true)}
              style={{
                marginTop: 8, width: "100%", padding: "18px 20px", borderRadius: 12, border: "none",
                background: cart.length === 0 ? t.panel3 : `linear-gradient(135deg, ${t.good}, #059669)`,
                color: cart.length === 0 ? t.textLo : "#fff",
                fontSize: 16, fontWeight: 800, cursor: cart.length === 0 ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                boxShadow: cart.length === 0 ? "none" : `0 6px 16px ${t.good}55`,
                letterSpacing: 0.3, transition: "transform .1s, box-shadow .15s",
              }}
              onMouseEnter={e => { if (cart.length > 0) (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; }}>
              <DollarSign size={20} /> COBRAR {mxn(total)}
            </button>
            {cart.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button onClick={() => setShowPay(true)} title="Efectivo rápido"
                  style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Banknote size={13} /> Efectivo
                </button>
                <button onClick={() => setShowPay(true)} title="Tarjeta"
                  style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <CreditCard size={13} /> Tarjeta
                </button>
                <button onClick={() => setShowPay(true)} title="Transferencia"
                  style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <ArrowLeftRight size={13} /> Transferencia
                </button>
                <button onClick={() => setShowPay(true)} title="Pago mixto"
                  style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Sparkles size={13} /> Mixto
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPay && <PayModal t={t} session={session} total={total} cart={cart}
        customerData={customerData}
        onDone={(sale) => { setCart([]); setShowPay(false); setLastSale(sale); setHistoryRefresh(v => v + 1); setCustomerData(null); }}
        onCancel={() => setShowPay(false)} />}
      {tabletMode && (
        <TabletSelfServiceMode t={t} cart={cart} total={total} brandName={brandName} logoSrc={logoSrc}
          initialData={customerData}
          onExit={() => setTabletMode(false)}
          onReady={(data) => { setCustomerData(data); setTabletMode(false); }} />
      )}
      {showHistory && <SalesHistoryDrawer t={t} session={session} refreshKey={historyRefresh}
        onClose={() => setShowHistory(false)} />}
      {showClose && <CloseSessionModal t={t} session={session}
        onClosed={() => { setShowClose(false); onClosed(); }} onCancel={() => setShowClose(false)} />}
      {showCash && <CashMovementModal t={t} session={session} type={showCash}
        onDone={() => setShowCash(null)} onCancel={() => setShowCash(null)} />}
      {lastSale && <SaleSuccessModal t={t} sale={lastSale} onClose={() => setLastSale(null)} />}
      {showPrev && (
        <PreviousSessionDrawer t={t}
          terminalId={session.terminal_id}
          scope="terminal"
          onClose={() => setShowPrev(false)}
        />
      )}
      {showArqueos && <ReconciliationPanel t={t} onClose={() => setShowArqueos(false)} />}
    </div>
  );
}


// ── Modal de venta exitosa (centrado, siempre encima de la topbar) ────────
function SaleSuccessModal({ t, sale, onClose }: { t: any; sale: any; onClose: () => void }) {
  const [printing, setPrinting] = useState<58 | 80 | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const doPrint = async (width: 58 | 80) => {
    setPrinting(width);
    try {
      const blob = await posApi.downloadTicket(sale.order_id, width);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) setTimeout(() => w.print(), 500);
    } catch { alert("Error al imprimir ticket"); }
    finally { setPrinting(null); }
  };
  const doDownload = async () => {
    try {
      const blob = await posApi.downloadTicket(sale.order_id, 80);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ticket_${sale.folio}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch { alert("Error al descargar ticket"); }
  };

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, background: t.base, border: `2px solid ${t.good}55`, borderRadius: 20, boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 0 4px ${t.good}18`, overflow: "hidden", animation: "pop-in .18s ease-out" }}>
        <style>{`@keyframes pop-in { 0% { transform: scale(.92); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }`}</style>

        {/* Top gradient banner */}
        <div style={{ background: `linear-gradient(135deg, ${t.good}, #059669)`, padding: "28px 28px 22px", position: "relative" }}>
          <button onClick={onClose} title="Cerrar (Esc)"
            style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 60, height: 60, borderRadius: 30, background: "rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
              <Check size={34} color="#fff" strokeWidth={3} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>¡Venta exitosa!</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.9)", marginTop: 4, fontFamily: "monospace", fontWeight: 600 }}>{sale.folio}</div>
            </div>
          </div>
        </div>

        {/* Amounts */}
        <div style={{ padding: "24px 28px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Total cobrado</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{mxn(sale.total_amount)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Cambio</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: (sale.change || 0) > 0 ? t.warn : t.textLo, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{mxn(sale.change || 0)}</div>
            </div>
          </div>
        </div>

        {/* Ticket actions */}
        <div style={{ padding: 22 }}>
          <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 12, textAlign: "center" }}>
            Imprimir o descargar el ticket
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
            <button onClick={() => doPrint(80)} disabled={printing !== null}
              style={{ padding: "14px 16px", borderRadius: 12, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy || "#1e40af"})`, color: "#fff", cursor: printing ? "wait" : "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: printing ? 0.6 : 1, boxShadow: `0 4px 12px ${t.nova}44` }}>
              <Printer size={17} /> {printing === 80 ? "Imprimiendo…" : "Ticket 80mm"}
            </button>
            <button onClick={() => doPrint(58)} disabled={printing !== null}
              style={{ padding: "14px 16px", borderRadius: 12, border: `1px solid ${t.nova}55`, background: t.nova + "18", color: t.nova, cursor: printing ? "wait" : "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: printing ? 0.6 : 1 }}>
              <Printer size={17} /> {printing === 58 ? "Imprimiendo…" : "Ticket 58mm"}
            </button>
          </div>
          <button onClick={doDownload}
            style={{ width: "100%", padding: "11px 16px", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {downloaded ? <><Check size={14} /> Descargado</> : <><Download size={14} /> Descargar PDF</>}
          </button>
        </div>

        {/* Footer with next action */}
        <div style={{ padding: "16px 22px", borderTop: `1px solid ${t.border}`, background: t.panel2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11.5, color: t.textLo, lineHeight: 1.4 }}>
            Puedes reimprimir desde<br/><b style={{ color: t.nova }}>Ventas del turno</b> en cualquier momento
          </div>
          <button onClick={onClose}
            style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, boxShadow: `0 4px 12px ${t.good}44` }}>
            Nueva venta <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}


// ── Modales ─────────────────────────────────────────────────────────
type PayMode = "cash" | "card" | "transfer" | "mixed";

function PayModal({ t, session, total, cart, customerData, onDone, onCancel }: any) {
  // Modo por default: efectivo (95% de las ventas de un POS son en efectivo).
  // El cajero elige el método con un click en el botón grande. Si el pago es
  // mixto, presiona "Mixto" y aparecen los tres inputs editables.
  const [mode, setMode] = useState<PayMode>("cash");
  const [cash, setCash] = useState<number>(total);
  const [card, setCard] = useState<number>(0);
  const [transfer, setTransfer] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  // Al cambiar de modo, resetear valores según el método elegido.
  useEffect(() => {
    if (mode === "cash") { setCash(total); setCard(0); setTransfer(0); }
    else if (mode === "card") { setCash(0); setCard(total); setTransfer(0); }
    else if (mode === "transfer") { setCash(0); setCard(0); setTransfer(total); }
    // "mixed" no auto-fill — el cajero teclea manualmente
  }, [mode, total]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  const paid = cash + card + transfer;
  const change = mode === "cash" || mode === "mixed" ? paid - total : 0;
  const isValid = mode === "cash"
    ? cash + 0.005 >= total
    : mode === "card"
      ? Math.abs(card - total) < 0.005
      : mode === "transfer"
        ? Math.abs(transfer - total) < 0.005
        : paid + 0.005 >= total && (card + transfer) <= total + 0.005;

  const submit = async () => {
    setSaving(true);
    try {
      const payments: Record<string, number> = {};
      if (card > 0) payments.card = Math.round(card * 100) / 100;
      if (transfer > 0) payments.transfer = Math.round(transfer * 100) / 100;
      if (cash > 0) {
        // En modo cash o mixto, registrar el efectivo real (para calcular cambio).
        payments.cash = Math.round(cash * 100) / 100;
      }
      // Si el cliente capturó datos vía tablet autoservicio, los adjuntamos
      // como nota estructurada de la venta (para trazabilidad y factura).
      let notes: string | undefined = undefined;
      if (customerData) {
        const bits: string[] = [];
        if (customerData.name) bits.push(`Cliente: ${customerData.name}`);
        if (customerData.email) bits.push(`Email: ${customerData.email}`);
        if (customerData.phone) bits.push(`Tel: ${customerData.phone}`);
        if (customerData.rfc) bits.push(`RFC: ${customerData.rfc}`);
        if (customerData.wants_invoice) bits.push("Solicita factura");
        if (bits.length) notes = bits.join(" · ");
      }
      const res = await posApi.registerSale({
        session_id: session.id, customer_id: undefined,
        items: cart.map((it: any) => ({
          variant_id: it.variant_id, product_name: it.product_name, sku: it.sku,
          quantity: it.quantity, unit_price: it.unit_price,
          discount_amount: it.discount_amount || 0, tax_rate: it.tax_rate || 16,
          is_service: it.is_service || false,
        })),
        payments, tax_rate: 16, notes,
      });
      onDone(res);
    } catch (e: any) { alert(e?.response?.data?.detail || "Error al cobrar"); }
    finally { setSaving(false); }
  };

  const methodDefs = [
    { key: "cash" as const,     label: "Efectivo",      ic: Banknote,       c: t.good },
    { key: "card" as const,     label: "Tarjeta",       ic: CreditCard,     c: t.nova },
    { key: "transfer" as const, label: "Transferencia", ic: ArrowLeftRight, c: "#A78BFA" },
  ];

  return (
    <div style={{ ...modalBg, zIndex: 9990 }} onClick={onCancel}>
      <div style={{ ...modalPane, background: t.panel, border: `1px solid ${t.border}`, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, background: `linear-gradient(135deg, ${t.panel2}, ${t.panel})` }}>
          <div style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Total a cobrar</div>
          <div style={{ fontSize: 36, fontWeight: 900, color: t.textHi, fontVariantNumeric: "tabular-nums", lineHeight: 1.1, marginTop: 2 }}>{mxn(total)}</div>
        </div>

        {/* Selector de método (botones grandes) */}
        <div style={{ padding: "18px 20px 8px" }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10, fontWeight: 700 }}>Método de pago</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {methodDefs.map(m => {
              const on = mode === m.key;
              const Icon = m.ic;
              return (
                <button key={m.key} onClick={() => setMode(m.key)}
                  style={{ padding: "14px 8px", borderRadius: 12, border: on ? `2px solid ${m.c}` : `1px solid ${t.border}`, background: on ? m.c + "20" : t.panel2, color: on ? m.c : t.textMid, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: on ? 800 : 600, transition: "all .12s", boxShadow: on ? `0 4px 12px ${m.c}33` : "none" }}>
                  <Icon size={22} strokeWidth={on ? 2.5 : 2} />
                  {m.label}
                </button>
              );
            })}
            {(() => {
              const on = mode === "mixed";
              return (
                <button onClick={() => setMode("mixed")}
                  style={{ padding: "14px 8px", borderRadius: 12, border: on ? `2px solid ${t.warn}` : `1px solid ${t.border}`, background: on ? t.warn + "20" : t.panel2, color: on ? t.warn : t.textMid, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: on ? 800 : 600, transition: "all .12s", boxShadow: on ? `0 4px 12px ${t.warn}33` : "none" }}>
                  <DollarSign size={22} strokeWidth={on ? 2.5 : 2} />
                  Mixto
                </button>
              );
            })()}
          </div>
        </div>

        {/* Inputs de monto */}
        <div style={{ padding: "10px 20px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "cash" && (
            <MoneyInput t={t} label="Efectivo recibido" value={cash} onChange={setCash} color={t.good} icon={Banknote} big />
          )}
          {mode === "card" && (
            <MoneyInput t={t} label="Monto con tarjeta" value={card} onChange={setCard} color={t.nova} icon={CreditCard} big />
          )}
          {mode === "transfer" && (
            <MoneyInput t={t} label="Monto por transferencia" value={transfer} onChange={setTransfer} color="#A78BFA" icon={ArrowLeftRight} big />
          )}
          {mode === "mixed" && (
            <>
              <MoneyInput t={t} label="Efectivo" value={cash} onChange={setCash} color={t.good} icon={Banknote} />
              <MoneyInput t={t} label="Tarjeta" value={card} onChange={setCard} color={t.nova} icon={CreditCard} />
              <MoneyInput t={t} label="Transferencia" value={transfer} onChange={setTransfer} color="#A78BFA" icon={ArrowLeftRight} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: t.textLo, padding: "4px 2px" }}>
                <span>Suma capturada</span>
                <span style={{ fontWeight: 700, color: paid >= total ? t.good : t.warn, fontVariantNumeric: "tabular-nums" }}>{mxn(paid)}</span>
              </div>
            </>
          )}
        </div>

        {/* Cambio / faltante */}
        <div style={{ padding: "8px 20px 18px" }}>
          <div style={{ padding: "14px 16px", background: change >= 0 ? t.good + "18" : t.bad + "18", borderRadius: 12, border: `1px solid ${change >= 0 ? t.good : t.bad}55`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {mode === "card" || mode === "transfer"
                  ? "Sin efectivo"
                  : (change >= 0 ? "Cambio a entregar" : "Falta por cobrar")}
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: change >= 0 ? t.good : t.bad, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {mode === "card" || mode === "transfer" ? mxn(0) : mxn(Math.abs(change))}
              </div>
            </div>
            {(mode === "card" || mode === "transfer") && isValid && (
              <div style={{ fontSize: 11.5, color: t.textLo, textAlign: "right", maxWidth: 180, lineHeight: 1.4 }}>
                El cliente pagará exactamente<br /><b style={{ color: t.textHi }}>{mxn(total)}</b> con {mode === "card" ? "tarjeta" : "transferencia"}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: t.panel2 }}>
          <button onClick={onCancel} style={{ padding: "11px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>
            Cancelar (Esc)
          </button>
          <button disabled={saving || !isValid} onClick={submit}
            style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: !isValid ? t.panel3 : `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: !isValid ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 8, boxShadow: isValid ? `0 4px 12px ${t.good}55` : "none" }}>
            <Check size={16} /> {saving ? "Procesando…" : `Cobrar ${mxn(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoneyInput({ t, label, value, onChange, color, icon: Icon, big }:
  { t: any; label: string; value: number; onChange: (v: number) => void; color: string; icon: any; big?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (big) inputRef.current?.select(); }, [big]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: big ? 48 : 40, height: big ? 48 : 40, borderRadius: 10, background: color + "22", color, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon size={big ? 20 : 16} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: t.textLo, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
        <input ref={inputRef} type="number" step={0.01} min={0} value={value || ""}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          onFocus={e => e.target.select()}
          style={{ width: "100%", padding: big ? "12px 14px" : "9px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: big ? 22 : 15, fontWeight: 800, outline: "none", fontVariantNumeric: "tabular-nums" }} />
      </div>
    </div>
  );
}

function CashMovementModal({ t, session, type, onDone, onCancel }: any) {
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const label = type === "cash_in" ? "Depósito a caja (fondo)" : "Retiro de caja";
  return (
    <div style={modalBg} onClick={onCancel}>
      <div style={{ ...modalPane, background: t.panel, border: `1px solid ${t.border}`, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 20 }}>
          <h3 style={{ margin: 0, color: t.textHi, fontSize: 16 }}>{label}</h3>
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 11.5, color: t.textLo }}>Monto</label>
            <input type="number" step={0.01} min={0} value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              autoFocus
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 16, fontWeight: 700, marginTop: 3 }} />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11.5, color: t.textLo }}>Motivo / notas</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej. Deposito para cambio"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, marginTop: 3 }} />
          </div>
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer" }}>Cancelar</button>
          <button disabled={amount <= 0} onClick={async () => {
            try { await posApi.cashMovement({ session_id: session.id, type, amount, notes: notes || undefined }); onDone(); }
            catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
          }} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontWeight: 700 }}>Registrar</button>
        </div>
      </div>
    </div>
  );
}

function CloseSessionModal({ t, session, onClosed, onCancel }: any) {
  const [dens, setDens] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const actual = DENOMINATIONS.reduce((a, d) => a + d * (dens[String(d)] || 0), 0);
  return (
    <div style={modalBg} onClick={onCancel}>
      <div style={{ ...modalPane, background: t.panel, border: `1px solid ${t.border}`, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 20 }}>
          <h3 style={{ margin: 0, color: t.textHi, fontSize: 17 }}>Cierre de turno · Arqueo</h3>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 4 }}>Cuenta el efectivo por denominación. El sistema calcula la variance automáticamente.</div>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {DENOMINATIONS.map(d => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: t.panel2, borderRadius: 8 }}>
                <div style={{ minWidth: 60, fontSize: 13, fontWeight: 700, color: t.textMid }}>${d}</div>
                <input type="number" min={0} value={dens[String(d)] || ""} onChange={e => setDens(f => ({ ...f, [String(d)]: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, textAlign: "right" }} />
                <div style={{ minWidth: 80, fontSize: 11, color: t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {mxn(d * (dens[String(d)] || 0))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: 12, background: t.nova + "18", border: `1px solid ${t.nova}55`, borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: t.textHi, fontWeight: 700 }}>Total contado</span>
            <span style={{ fontSize: 17, fontWeight: 900, color: t.nova }}>{mxn(actual)}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11.5, color: t.textLo }}>Notas de cierre</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej. Se dejaron $500 de cambio para el siguiente turno"
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, marginTop: 3 }} />
          </div>
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer" }}>Cancelar</button>
          <button disabled={saving} onClick={async () => {
            setSaving(true);
            try {
              const closed = await posApi.closeSession({ session_id: session.id, denominations: dens, closing_notes: notes || undefined });
              const openZ = confirm(
                `Turno cerrado.\n\n`
                + `Esperado: ${mxn(closed.expected_cash)}\n`
                + `Contado:  ${mxn(closed.actual_cash)}\n`
                + `Diferencia: ${closed.variance >= 0 ? "+" : ""}${mxn(closed.variance)}\n\n`
                + `Ventas: ${closed.total_sales_count} · ${mxn(closed.total_sales_amount)}\n\n`
                + `¿Descargar el reporte Z (PDF)?`
              );
              if (openZ) {
                try {
                  const blob = await posApi.downloadSessionReport(session.id, "Z");
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `reporte_Z_turno_${session.id}.pdf`;
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                } catch { /* silencio: el cierre ya se ejecutó */ }
              }
              onClosed();
            } catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
            finally { setSaving(false); }
          }} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <Lock size={13} /> {saving ? "Cerrando…" : "Cerrar turno"}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalBg: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalPane: React.CSSProperties = { width: "100%", maxWidth: 480, borderRadius: 14, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" };


// ── Historial de ventas del turno ─────────────────────────────────────────
function SalesHistoryDrawer({ t, session, refreshKey, onClose }: {
  t: any; session: POSSession; refreshKey: number; onClose: () => void;
}) {
  const [sales, setSales] = useState<SessionSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await posApi.sessionSales(session.id);
      setSales(rows);
    } catch (e: any) {
      setError("No se pudo cargar el historial de ventas.");
      setSales([]);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [session.id, refreshKey]);

  const printTicket = async (orderId: number, width: 58 | 80) => {
    setBusy(orderId);
    try {
      const blob = await posApi.downloadTicket(orderId, width);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) { setTimeout(() => w.print(), 500); }
    } catch { alert("Error al imprimir ticket"); }
    finally { setBusy(null); }
  };
  const downloadTicket = async (orderId: number, folio: string | null) => {
    setBusy(orderId);
    try {
      const blob = await posApi.downloadTicket(orderId, 80);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ticket_${folio || orderId}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert("Error al descargar ticket"); }
    finally { setBusy(null); }
  };

  const totalSold = sales.reduce((a, s) => a + (s.total_amount || 0), 0);
  const salesCount = sales.length;

  const filtered = q.trim()
    ? sales.filter(s => {
        const qs = q.toLowerCase();
        return (s.folio || "").toLowerCase().includes(qs)
          || (s.customer_name || "").toLowerCase().includes(qs)
          || String(s.total_amount).includes(qs);
      })
    : sales;

  const methodLabel: Record<string, { label: string; color: string; icon: any }> = {
    cash: { label: "Efectivo", color: t.good, icon: Banknote },
    card: { label: "Tarjeta", color: t.nova, icon: CreditCard },
    transfer: { label: "Transf.", color: "#A78BFA", icon: ArrowLeftRight },
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.7)", zIndex: 9998, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: "100vw", height: "100%", background: t.base, borderLeft: `1px solid ${t.border}`, display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${t.border}`, background: t.panel, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Receipt size={18} color={t.nova} />
              <div style={{ fontSize: 16, fontWeight: 800, color: t.textHi }}>Ventas del turno</div>
            </div>
            <div style={{ fontSize: 12, color: t.textLo }}>
              {session.terminal_name} · Cajero {session.cashier_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* KPI + búsqueda */}
        <div style={{ padding: "14px 22px", borderBottom: `1px solid ${t.border}`, background: t.panel2, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: t.textLo, marginBottom: 2 }}>Ventas realizadas</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{salesCount}</div>
            </div>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: t.textLo, marginBottom: 2 }}>Total cobrado</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(totalSold)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Search size={14} color={t.textLo} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio, cliente o monto…"
                style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none" }} />
            </div>
            <button onClick={load} title="Actualizar"
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>Cargando…</div>}
          {error && (
            <div style={{ padding: "12px 14px", background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>
              <Receipt size={32} style={{ opacity: 0.35, marginBottom: 10 }} />
              <div style={{ fontSize: 13.5, fontWeight: 600, color: t.textMid }}>
                {sales.length === 0 ? "Aún no hay ventas en este turno" : "Sin resultados"}
              </div>
              {sales.length === 0 && (
                <div style={{ fontSize: 12, color: t.textLo, marginTop: 4 }}>
                  Cada venta aparecerá aquí para que puedas reimprimir el ticket en cualquier momento.
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(s => {
              const hh = s.created_at ? new Date(s.created_at) : null;
              const timeStr = hh ? hh.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
              const dateStr = hh ? hh.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "";
              const isWorking = busy === s.order_id;
              return (
                <div key={s.order_id} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: t.nova, fontFamily: "monospace" }}>{s.folio || `#${s.order_id}`}</div>
                      <div style={{ fontSize: 11, color: t.textLo, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={10} />{dateStr} {timeStr}</span>
                        <span>· {s.items_count} art.</span>
                        {s.customer_name && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><User size={10} />{s.customer_name}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(s.total_amount)}</div>
                      {s.change > 0 && (
                        <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2 }}>Cambio {mxn(s.change)}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {s.payment_methods.map((m, i) => {
                      const meta = methodLabel[m] || { label: m, color: t.textLo, icon: DollarSign };
                      const Icon = meta.icon;
                      return (
                        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.color + "18", padding: "2px 8px", borderRadius: 20 }}>
                          <Icon size={10} /> {meta.label}
                        </span>
                      );
                    })}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                      <button disabled={isWorking} onClick={() => printTicket(s.order_id, 80)}
                        title="Reimprimir ticket 80mm"
                        style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${t.good}55`, background: t.good + "18", color: t.good, cursor: isWorking ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600 }}>
                        <Printer size={11} /> 80mm
                      </button>
                      <button disabled={isWorking} onClick={() => printTicket(s.order_id, 58)}
                        title="Reimprimir ticket 58mm"
                        style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: isWorking ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
                        <Printer size={11} /> 58mm
                      </button>
                      <button disabled={isWorking} onClick={() => downloadTicket(s.order_id, s.folio)}
                        title="Descargar PDF"
                        style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: isWorking ? "wait" : "pointer", display: "flex", alignItems: "center", fontSize: 11.5 }}>
                        <Download size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Arqueos / Conciliación: historial de turnos + pendientes ─────────────
function ReconTile({ t, label, value, color }: { t: any; label: string; value: string; color: string }) {
  return (
    <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function ReconciliationPanel({ t, onClose }: { t: any; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SessionListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      setData(await posApi.listSessions({ pending: pendingOnly, limit: 200 }));
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error al cargar arqueos");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [pendingOnly]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const sum = data?.summary;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 300, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 880, maxWidth: "100%", height: "100vh", background: t.panel, borderLeft: `1px solid ${t.border}`, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: t.panel, zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Scale size={20} color={t.nova} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.textHi }}>Arqueos / Conciliación</div>
              <div style={{ fontSize: 12, color: t.textLo }}>Historial de turnos y saldos pendientes por depositar</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>

        {sum && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, padding: "16px 22px" }}>
            <ReconTile t={t} label="Turnos pendientes" value={String(sum.pending_count)} color={sum.pending_count > 0 ? t.warn : t.good} />
            <ReconTile t={t} label="Pendiente por depositar" value={mxn(sum.total_pending_deposit)} color={sum.total_pending_deposit > 0.005 ? t.warn : t.good} />
            <ReconTile t={t} label={sum.accumulated_variance >= 0 ? "Saldo acumulado a favor" : "Saldo acumulado en contra"} value={(sum.accumulated_variance >= 0 ? "+" : "−") + mxn(Math.abs(sum.accumulated_variance))} color={Math.abs(sum.accumulated_variance) < 0.005 ? t.textMid : sum.accumulated_variance > 0 ? t.good : t.bad} />
          </div>
        )}

        <div style={{ display: "flex", gap: 8, padding: "0 22px 12px" }}>
          {[{ v: true, l: "Pendientes" }, { v: false, l: "Todos" }].map(o => (
            <button key={String(o.v)} onClick={() => setPendingOnly(o.v)} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${pendingOnly === o.v ? t.nova : t.border}`, background: pendingOnly === o.v ? t.nova + "1a" : "transparent", color: pendingOnly === o.v ? t.nova : t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>{o.l}</button>
          ))}
        </div>

        <div style={{ flex: 1, padding: "0 22px 22px" }}>
          {loading ? <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>
            : err ? <div style={{ padding: 20, color: t.bad }}>{err}</div>
            : !data || data.sessions.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>{pendingOnly ? "No hay turnos pendientes por conciliar. 🎉" : "Sin turnos registrados."}</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.sessions.map(s => {
                  const vColor = Math.abs(s.variance) < 0.005 ? t.textLo : s.variance > 0 ? t.good : t.bad;
                  const stColor = s.status === "reconciled" ? t.good : s.status === "open" ? t.nova : t.warn;
                  const stLabel = s.status === "reconciled" ? "Conciliado" : s.status === "open" ? "Abierto" : "Cerrado";
                  const clickable = s.status !== "open";
                  return (
                    <div key={s.id} onClick={() => clickable && setOpenSessionId(s.id)}
                      style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr auto", gap: 10, alignItems: "center", padding: "12px 14px", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, cursor: clickable ? "pointer" : "default" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{s.terminal_name} · #{s.id}</div>
                        <div style={{ fontSize: 11.5, color: t.textLo, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.cashier_name} · {fmtDate(s.closed_at || s.opened_at)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3 }}>Varianza</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: vColor }}>{s.variance >= 0 ? "+" : "−"}{mxn(Math.abs(s.variance))}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3 }}>Por depositar</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: s.cash_remaining_after > 0.005 ? t.warn : t.textLo }}>{mxn(s.cash_remaining_after)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3 }}>Ventas</div>
                        <div style={{ fontSize: 13, color: t.textMid }}>{mxn(s.total_sales_amount)}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: stColor, background: stColor + "1e", border: `1px solid ${stColor}44`, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{stLabel}</span>
                        {clickable && <ChevronRight size={16} color={t.textLo} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </div>

      {openSessionId !== null && (
        <PreviousSessionDrawer t={t} scope="any" sessionId={openSessionId}
          onClose={() => { setOpenSessionId(null); load(); }} />
      )}
    </div>,
    document.body,
  );
}

// ── Turno anterior: reporte del último turno cerrado ─────────────────────
function PreviousSessionDrawer({ t, terminalId, scope, sessionId, onClose }: {
  t: any;
  terminalId?: number;
  scope: "auto" | "me" | "terminal" | "any";
  sessionId?: number;               // si viene, abre ESE turno (no solo el último)
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<PreviousSessionReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"Z" | "X" | null>(null);
  const [reprint, setReprint] = useState<number | null>(null);
  const [reconcileType, setReconcileType] = useState<"bank_deposit" | "float_next_shift" | "adjustment" | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [recounting, setRecounting] = useState(false);
  const [markingReconciled, setMarkingReconciled] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const loadReport = async (sessionId?: number) => {
    setLoading(true); setErr(null);
    try {
      const r = sessionId
        ? await posApi.sessionReport(sessionId) as PreviousSessionReport
        : await posApi.previousSession({ terminal_id: terminalId, scope });
      setReport(r);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setErr(e?.response?.status === 404
        ? "No hay turnos cerrados anteriores para mostrar."
        : (detail || e?.message || "Error al cargar el turno anterior"));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const r = sessionId
          ? await posApi.sessionReport(sessionId) as PreviousSessionReport
          : await posApi.previousSession({ terminal_id: terminalId, scope });
        if (!cancelled) setReport(r);
      } catch (e: any) {
        if (!cancelled) {
          const detail = e?.response?.data?.detail;
          setErr(e?.response?.status === 404
            ? "No hay turnos cerrados anteriores para mostrar."
            : (detail || e?.message || "Error al cargar el turno anterior"));
        }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [terminalId, scope, sessionId]);

  const flashOk = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2600);
  };

  const doMarkReconciled = async () => {
    if (!report) return;
    if (!confirm("¿Marcar este turno como reconciliado? Podrás seguir agregando movimientos o deshacerlo si necesitas.")) return;
    setMarkingReconciled(true);
    try {
      const r = await posApi.markReconciled(report.id);
      setReport(r);
      flashOk("Turno marcado como reconciliado");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setMarkingReconciled(false); }
  };

  const doUnmarkReconciled = async () => {
    if (!report) return;
    if (!confirm("¿Volver el turno a 'Cerrado' para seguir editando?")) return;
    setMarkingReconciled(true);
    try {
      const r = await posApi.unmarkReconciled(report.id);
      setReport(r);
      flashOk("Turno de vuelta a 'Cerrado'");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setMarkingReconciled(false); }
  };

  const downloadZ = async (kind: "Z" | "X") => {
    if (!report) return;
    setDownloading(kind);
    try {
      const blob = await posApi.downloadSessionReport(report.id, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `reporte_${kind}_turno_${report.id}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert("Error al descargar el reporte"); }
    finally { setDownloading(null); }
  };

  const reprintTicket = async (orderId: number) => {
    setReprint(orderId);
    try {
      const blob = await posApi.downloadTicket(orderId, 80);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) setTimeout(() => w.print(), 500);
    } catch { alert("Error al reimprimir ticket"); }
    finally { setReprint(null); }
  };

  const fmtDT = (v?: string | null) => {
    if (!v) return "—";
    try { return new Date(v).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return v; }
  };
  const varianceColor = report && Math.abs(report.variance || 0) < 0.01 ? t.good
    : report && (report.variance || 0) > 0 ? t.nova : t.bad;

  const methodLabels: Record<string, string> = {
    cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia",
    credit: "Crédito", unknown: "Otro",
  };
  const txLabels: Record<string, { label: string; color: string }> = {
    opening: { label: "Apertura", color: t.textMid },
    closing: { label: "Cierre", color: t.textMid },
    sale: { label: "Venta", color: t.good },
    refund: { label: "Reembolso", color: t.bad },
    cash_in: { label: "Fondo", color: t.nova },
    cash_out: { label: "Retiro", color: t.warn },
    bank_deposit: { label: "Depósito banco", color: t.nova },
    float_next_shift: { label: "Fondo próximo turno", color: t.warn },
    adjustment: { label: "Ajuste", color: t.bad },
  };

  const saleTxs = (report?.transactions || []).filter(x => x.type === "sale" && x.order_id);
  const orderIds = Array.from(new Set(saleTxs.map(x => x.order_id!)));

  const modal = (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 500, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 620, maxWidth: "100%", background: t.panel, borderLeft: `1px solid ${t.border}`, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, background: t.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 2 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.textHi, display: "flex", alignItems: "center", gap: 8 }}>
              <History size={16} color={t.nova} /> Turno anterior
              {report && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                  background: report.status === "reconciled" ? t.good + "22" : t.warn + "22",
                  color: report.status === "reconciled" ? t.good : t.warn,
                  textTransform: "uppercase", letterSpacing: 0.4,
                }}>
                  {report.status === "reconciled" ? "Reconciliado" : "Cerrado"}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 3 }}>
              {scope === "terminal" ? "Último cierre en esta caja"
                : scope === "any" ? "Último cierre global"
                : "Tu último cierre"}
              {report && <> · Turno #{report.id}</>}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, padding: 18 }}>
          {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
          {err && !loading && (
            <div style={{ padding: 30, textAlign: "center", color: t.textLo }}>
              <AlertTriangle size={28} color={t.warn} />
              <div style={{ marginTop: 12, fontSize: 13 }}>{err}</div>
            </div>
          )}
          {report && !loading && !err && (
            <>
              <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12.5 }}>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Caja</div>
                    <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2 }}>{report.terminal_name}</div>
                  </div>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Cajero</div>
                    <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2 }}>{report.cashier_name}</div>
                  </div>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Abierto</div>
                    <div style={{ color: t.textMid, marginTop: 2 }}>{fmtDT(report.opened_at)}</div>
                  </div>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Cerrado</div>
                    <div style={{ color: t.textMid, marginTop: 2 }}>{fmtDT(report.closed_at)}</div>
                  </div>
                </div>
                {(report.opening_notes || report.closing_notes) && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}`, fontSize: 11.5, color: t.textLo }}>
                    {report.opening_notes && <div>📝 Apertura: {report.opening_notes}</div>}
                    {report.closing_notes && <div style={{ marginTop: 4 }}>🔒 Cierre: {report.closing_notes}</div>}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <StatMini t={t} label="Ventas" value={mxn(report.total_sales_amount)} sub={`${report.total_sales_count} tickets`} />
                <StatMini t={t} label="Fondo inicial" value={mxn(report.opening_balance)} />
                <StatMini t={t} label="Reembolsos" value={mxn(report.total_refunds)} />
                <StatMini t={t} label="Entradas caja" value={mxn(report.total_cash_in)} />
                <StatMini t={t} label="Salidas caja" value={mxn(report.total_cash_out)} />
                <StatMini t={t} label="Diferencia" value={mxn(report.variance)} color={varianceColor} />
              </div>

              {(() => {
                const netVar = (report.variance || 0) + (report.total_adjustments || 0);
                const bigMiss = Math.abs(netVar) >= 100
                  || (report.expected_cash > 0 && Math.abs(netVar) / report.expected_cash >= 0.01);
                if (!bigMiss) return null;
                return (
                  <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: t.bad + "22", border: `1px solid ${t.bad}55`, color: t.bad, fontSize: 12.5, display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        Diferencia sin justificar: {mxn(netVar)}
                      </div>
                      <div style={{ marginTop: 3, color: t.textMid, fontSize: 11.5 }}>
                        Si contaste mal el efectivo al cerrar, usa <b>Corregir arqueo</b>. Si el faltante es real, regístralo con <b>Ajuste con motivo</b>.
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: 14, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Arqueo</div>
                  {(report.status === "closed" || report.status === "reconciled") && (
                    <button onClick={() => setRecounting(true)}
                      title="Reingresar denominaciones para corregir un mal conteo"
                      style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                      <RefreshCw size={11} /> Corregir arqueo
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 13 }}>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5 }}>Esperado</div>
                    <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(report.expected_cash)}</div>
                  </div>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5 }}>Contado</div>
                    <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(report.actual_cash)}</div>
                  </div>
                  <div>
                    <div style={{ color: t.textLo, fontSize: 10.5 }}>Diferencia</div>
                    <div style={{ color: varianceColor, fontWeight: 800, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {(report.variance || 0) >= 0 ? "+" : ""}{mxn(report.variance)}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Reconciliación post-cierre ─────────────────────────── */}
              <div style={{ marginTop: 14, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Reconciliación post-cierre</div>
                  <div style={{ fontSize: 10.5, color: t.textLo }}>
                    Pendiente: <b style={{ color: (report.cash_remaining_after || 0) > 0.01 ? t.warn : t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(report.cash_remaining_after)}</b>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12, marginBottom: 10 }}>
                  <div style={{ padding: "8px 10px", background: t.panel3, borderRadius: 6 }}>
                    <div style={{ color: t.textLo, fontSize: 10.5 }}>Depositado al banco</div>
                    <div style={{ color: t.nova, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(report.total_deposited)}</div>
                  </div>
                  <div style={{ padding: "8px 10px", background: t.panel3, borderRadius: 6 }}>
                    <div style={{ color: t.textLo, fontSize: 10.5 }}>Fondo próximo turno</div>
                    <div style={{ color: t.warn, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(report.total_float_next)}</div>
                  </div>
                  <div style={{ padding: "8px 10px", background: t.panel3, borderRadius: 6 }}>
                    <div style={{ color: t.textLo, fontSize: 10.5 }}>Ajustes</div>
                    <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(report.total_adjustments)}</div>
                  </div>
                </div>

                {(report.status === "closed" || report.status === "reconciled") ? (
                  <>
                    {report.status === "reconciled" && (
                      <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: t.good + "18", color: t.good, fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                        <Check size={13} /> Turno ya reconciliado. Puedes seguir agregando movimientos o deshacer para editar de nuevo.
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <button onClick={() => setReconcileType("bank_deposit")}
                        title="Registrar el efectivo que se llevó al banco"
                        style={{ padding: "8px 12px", borderRadius: 7, border: `1px solid ${t.nova}55`, background: t.nova + "18", color: t.nova, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        <Banknote size={13} /> Depósito banco
                      </button>
                      <button onClick={() => setReconcileType("float_next_shift")}
                        title="Registrar el efectivo dejado como fondo del siguiente turno"
                        style={{ padding: "8px 12px", borderRadius: 7, border: `1px solid ${t.warn}55`, background: t.warn + "18", color: t.warn, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        <ArrowLeftRight size={13} /> Fondo próximo turno
                      </button>
                      <button onClick={() => setReconcileType("adjustment")}
                        title="Registrar un ajuste con motivo (sobrante o faltante justificado)"
                        style={{ padding: "8px 12px", borderRadius: 7, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        <AlertTriangle size={13} /> Ajuste con motivo
                      </button>
                      <button onClick={() => setEditingNotes(true)}
                        title="Corregir notas de apertura o cierre"
                        style={{ padding: "8px 12px", borderRadius: 7, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                        <Receipt size={13} /> Editar notas
                      </button>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {report.status === "closed" && (report.cash_remaining_after || 0) <= 0.01 && (
                        <button disabled={markingReconciled} onClick={doMarkReconciled}
                          style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: markingReconciled ? "wait" : "pointer", fontWeight: 800, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                          <Check size={14} /> {markingReconciled ? "Marcando…" : "Marcar como reconciliado"}
                        </button>
                      )}
                      {report.status === "reconciled" && (
                        <button disabled={markingReconciled} onClick={doUnmarkReconciled}
                          style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: markingReconciled ? "wait" : "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                          <RefreshCw size={13} /> {markingReconciled ? "…" : "Deshacer reconciliación"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: "10px 12px", borderRadius: 6, background: t.warn + "18", color: t.warn, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={13} /> Este turno no está cerrado (estado: {report.status}). La reconciliación solo aplica a turnos cerrados.
                  </div>
                )}
                {flash && (
                  <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: t.good + "22", color: t.good, fontSize: 11.5, fontWeight: 700 }}>
                    ✓ {flash}
                  </div>
                )}
              </div>

              {Object.keys(report.sales_by_method || {}).length > 0 && (
                <div style={{ marginTop: 14, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Ventas por método</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {Object.entries(report.sales_by_method).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.textMid }}>
                        <span>{methodLabels[k] || k}</span>
                        <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(v as number)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {orderIds.length > 0 && (
                <div style={{ marginTop: 14, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Tickets del turno</span>
                    <span style={{ color: t.textMid, textTransform: "none", letterSpacing: 0 }}>{orderIds.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                    {orderIds.map(oid => (
                      <div key={oid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: t.panel3, borderRadius: 6, fontSize: 12 }}>
                        <span style={{ color: t.textMid, fontFamily: "monospace" }}>#{oid}</span>
                        <button disabled={reprint === oid}
                          onClick={() => reprintTicket(oid)}
                          style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${t.good}55`, background: t.good + "18", color: t.good, cursor: reprint === oid ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600 }}>
                          <Printer size={10} /> {reprint === oid ? "…" : "Reimprimir"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.transactions && report.transactions.length > 0 && (
                <div style={{ marginTop: 14, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Movimientos</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto", fontSize: 12 }}>
                    {report.transactions.map((tx: POSTransactionRow) => {
                      const meta = txLabels[tx.type] || { label: tx.type, color: t.textMid };
                      return (
                        <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", borderRadius: 5 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ color: meta.color, fontWeight: 700, fontSize: 11 }}>{meta.label}</span>
                            {tx.notes && <span style={{ color: t.textLo, fontSize: 10.5 }}>{tx.notes}</span>}
                          </div>
                          <span style={{ color: t.textHi, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {mxn(tx.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button disabled={downloading === "Z"} onClick={() => downloadZ("Z")}
                  style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, #2563EB)`, color: "#fff", cursor: downloading ? "wait" : "pointer", fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                  <Download size={14} /> {downloading === "Z" ? "Descargando…" : "Descargar Reporte Z (PDF)"}
                </button>
                <button disabled={downloading === "X"} onClick={() => downloadZ("X")}
                  style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: downloading ? "wait" : "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                  <Download size={14} /> {downloading === "X" ? "…" : "Corte X"}
                </button>
              </div>
            </>
          )}
        </div>

        {report && reconcileType && (
          <ReconcileMovementModal t={t}
            sessionId={report.id}
            type={reconcileType}
            maxAmount={report.cash_remaining_after}
            onClose={() => setReconcileType(null)}
            onDone={async () => {
              const type = reconcileType;
              setReconcileType(null);
              await loadReport(report.id);
              flashOk(
                type === "bank_deposit" ? "Depósito bancario registrado"
                  : type === "float_next_shift" ? "Fondo del próximo turno registrado"
                  : "Ajuste registrado"
              );
            }}
          />
        )}
        {report && editingNotes && (
          <EditNotesModal t={t}
            sessionId={report.id}
            initialOpening={report.opening_notes || ""}
            initialClosing={report.closing_notes || ""}
            onClose={() => setEditingNotes(false)}
            onDone={async () => {
              setEditingNotes(false);
              await loadReport(report.id);
              flashOk("Notas actualizadas");
            }}
          />
        )}
        {report && recounting && (
          <RecountModal t={t}
            sessionId={report.id}
            initialDenominations={report.denominations_json || {}}
            expectedCash={report.expected_cash}
            onClose={() => setRecounting(false)}
            onDone={async () => {
              setRecounting(false);
              await loadReport(report.id);
              flashOk("Arqueo corregido");
            }}
          />
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


// ── Modales de reconciliación ────────────────────────────────────────────
function ReconcileMovementModal({ t, sessionId, type, maxAmount, onClose, onDone }: {
  t: any;
  sessionId: number;
  type: "bank_deposit" | "float_next_shift" | "adjustment";
  maxAmount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [bankId, setBankId] = useState<number | null>(null);
  const [banks, setBanks] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (type === "bank_deposit") {
      posApi.bankAccountsForPos().then(bs => {
        setBanks(bs);
        if (bs.length > 0) setBankId(bs[0].id);
      }).catch(() => setBanks([]));
    }
  }, [type]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const config = {
    bank_deposit: {
      title: "Registrar depósito bancario",
      hint: "Efectivo llevado al banco tras el cierre. Se registra también en el módulo Finanzas.",
      color: t.nova, icon: Banknote,
      requireBank: true, requireNotes: false,
    },
    float_next_shift: {
      title: "Fondo dejado para el siguiente turno",
      hint: "Efectivo que queda en la caja como fondo del siguiente cajero.",
      color: t.warn, icon: ArrowLeftRight,
      requireBank: false, requireNotes: false,
    },
    adjustment: {
      title: "Ajuste con motivo",
      hint: "Registra un ajuste al efectivo del turno. El motivo queda en la bitácora.",
      color: t.bad, icon: AlertTriangle,
      requireBank: false, requireNotes: true,
    },
  }[type];
  const Icon = config.icon;

  const canSave = amount > 0
    && (type === "adjustment" || amount <= maxAmount + 0.005)
    && (!config.requireBank || bankId !== null)
    && (!config.requireNotes || notes.trim().length > 0);

  const submit = async () => {
    if (!canSave || saving) return;
    setSaving(true); setErr(null);
    try {
      await posApi.reconcileMovement(sessionId, {
        type,
        amount,
        notes: notes || undefined,
        bank_account_id: type === "bank_deposit" ? bankId! : undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error");
    } finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 460, maxWidth: "100%", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: config.color + "22", color: config.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={16} />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>{config.title}</h3>
        </div>
        <div style={{ fontSize: 12, color: t.textLo, marginBottom: 16 }}>{config.hint}</div>

        {type !== "adjustment" && (
          <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 6, background: t.panel2, fontSize: 11.5, color: t.textLo }}>
            Efectivo disponible del turno: <b style={{ color: t.textHi }}>{mxn(maxAmount)}</b>
          </div>
        )}

        <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Monto (MXN)</label>
        <div style={{ position: "relative", marginTop: 4 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textLo }}>$</span>
          <input type="number" step={0.01} min={0.01} value={amount || ""}
            onChange={e => setAmount(parseFloat(e.target.value) || 0)}
            autoFocus
            style={{ width: "100%", padding: "10px 14px 10px 26px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14 }} />
        </div>

        {config.requireBank && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Cuenta bancaria destino</label>
            {banks.length === 0 ? (
              <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 6, background: t.bad + "18", color: t.bad, fontSize: 12 }}>
                No hay cuentas bancarias activas. Crea una en Finanzas antes de registrar el depósito.
              </div>
            ) : (
              <select value={bankId ?? ""} onChange={e => setBankId(Number(e.target.value))}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14, marginTop: 4 }}>
                {banks.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.bank ? ` · ${b.bank}` : ""}{b.account_number ? ` (${b.account_number})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Notas {config.requireNotes ? <span style={{ color: t.bad }}>*</span> : "(opcional)"}
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder={type === "adjustment" ? "Motivo del ajuste (obligatorio)" : type === "bank_deposit" ? "Ej. Depósito ventanilla BBVA folio 12345" : "Ej. Se dejaron $500 en billetes chicos"}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, marginTop: 4, fontFamily: "inherit", resize: "vertical" }} />
        </div>

        {err && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: t.bad + "18", color: t.bad, fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer" }}>
            Cancelar
          </button>
          <button disabled={!canSave || saving} onClick={submit}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none",
              background: canSave ? `linear-gradient(135deg, ${config.color}, ${config.color}dd)` : t.panel3,
              color: "#fff", cursor: canSave && !saving ? "pointer" : "not-allowed", fontWeight: 800 }}>
            {saving ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


function EditNotesModal({ t, sessionId, initialOpening, initialClosing, onClose, onDone }: {
  t: any;
  sessionId: number;
  initialOpening: string;
  initialClosing: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [opening, setOpening] = useState(initialOpening);
  const [closing, setClosing] = useState(initialClosing);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const submit = async () => {
    setSaving(true); setErr(null);
    try {
      await posApi.updateSessionNotes(sessionId, {
        opening_notes: opening,
        closing_notes: closing,
      });
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error");
    } finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 500, maxWidth: "100%", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>Editar notas del turno</h3>
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Notas de apertura</label>
          <textarea value={opening} onChange={e => setOpening(e.target.value)} rows={2}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, marginTop: 4, fontFamily: "inherit", resize: "vertical" }} />
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Notas de cierre</label>
          <textarea value={closing} onChange={e => setClosing(e.target.value)} rows={4}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, marginTop: 4, fontFamily: "inherit", resize: "vertical" }} />
        </div>
        {err && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: t.bad + "18", color: t.bad, fontSize: 12 }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer" }}>
            Cancelar
          </button>
          <button disabled={saving} onClick={submit}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: saving ? "wait" : "pointer", fontWeight: 800 }}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


function StatMini({ t, label, value, sub, color }: {
  t: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || t.textHi, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}


// ── Corregir arqueo posterior al cierre ──────────────────────────────────
function RecountModal({ t, sessionId, initialDenominations, expectedCash, onClose, onDone }: {
  t: any;
  sessionId: number;
  initialDenominations: Record<string, number>;
  expectedCash: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [dens, setDens] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const d of DENOMINATIONS) seed[String(d)] = Number(initialDenominations?.[String(d)] || 0);
    return seed;
  });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const total = DENOMINATIONS.reduce((sum, d) => sum + d * (dens[String(d)] || 0), 0);
  const diff = total - expectedCash;
  const diffColor = Math.abs(diff) < 0.01 ? t.good : diff > 0 ? t.nova : t.bad;

  const submit = async () => {
    setSaving(true); setErr(null);
    try {
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(dens)) {
        if (Number(v) > 0) cleaned[k] = Number(v);
      }
      await posApi.recountSession(sessionId, {
        denominations: cleaned,
        notes: notes || undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error");
    } finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: t.warn + "22", color: t.warn, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <RefreshCw size={16} />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>Corregir arqueo</h3>
        </div>
        <div style={{ fontSize: 12, color: t.textLo, marginBottom: 14 }}>
          Reingresa las denominaciones si contaste mal el efectivo al cerrar. Se actualiza el total contado y la diferencia se recalcula automáticamente.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {DENOMINATIONS.map(d => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: t.panel2, borderRadius: 6 }}>
              <div style={{ minWidth: 60, fontSize: 12.5, color: t.textMid, fontWeight: 700 }}>{mxn(d)}</div>
              <div style={{ color: t.textLo, fontSize: 11 }}>×</div>
              <input type="number" min={0} step={1} value={dens[String(d)] || 0}
                onChange={e => setDens(prev => ({ ...prev, [String(d)]: Math.max(0, parseInt(e.target.value || "0", 10)) }))}
                style={{ flex: 1, padding: "6px 10px", borderRadius: 5, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13 }} />
              <div style={{ minWidth: 80, textAlign: "right", fontSize: 12, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>
                {mxn(d * (dens[String(d)] || 0))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: t.panel2, border: `1px solid ${t.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 12 }}>
            <div>
              <div style={{ color: t.textLo, fontSize: 10.5 }}>Esperado</div>
              <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(expectedCash)}</div>
            </div>
            <div>
              <div style={{ color: t.textLo, fontSize: 10.5 }}>Nuevo contado</div>
              <div style={{ color: t.textHi, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{mxn(total)}</div>
            </div>
            <div>
              <div style={{ color: t.textLo, fontSize: 10.5 }}>Diferencia</div>
              <div style={{ color: diffColor, fontWeight: 800, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {diff >= 0 ? "+" : ""}{mxn(diff)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Motivo (opcional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Ej. Encontré el efectivo que había quedado en la caja fuerte"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, marginTop: 4, fontFamily: "inherit", resize: "vertical" }} />
        </div>

        {err && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: t.bad + "18", color: t.bad, fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer" }}>
            Cancelar
          </button>
          <button disabled={saving} onClick={submit}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: saving ? "wait" : "pointer", fontWeight: 800 }}>
            {saving ? "Guardando…" : "Guardar re-arqueo"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


// ═══════════════════════════════════════════════════════════════════════════
// MODO TABLET AUTOSERVICIO
// Fullscreen kiosk-style overlay: la caja voltea la tablet al cliente. El
// cliente ve el ticket en tiempo real (mirror del carrito) y captura sus
// datos de contacto / factura. Al presionar "Listo" los datos regresan al
// cajero y quedan adjuntos a la venta.
//
// UX pensada para tablet táctil con pulgares: inputs grandes, botones anchos,
// tipografía legible a 60cm. Salida del cajero por 5 toques en el logo.
// ═══════════════════════════════════════════════════════════════════════════

function TabletSelfServiceMode({ t, cart, total, brandName, logoSrc, initialData, onExit, onReady }: {
  t: any; cart: CartItem[]; total: number; brandName: string; logoSrc: string | null;
  initialData: { name?: string; email?: string; phone?: string; rfc?: string; wants_invoice?: boolean } | null;
  onExit: () => void;
  onReady: (data: { name?: string; email?: string; phone?: string; rfc?: string; wants_invoice?: boolean }) => void;
}) {
  const [name, setName] = useState(initialData?.name || "");
  const [email, setEmail] = useState(initialData?.email || "");
  const [phone, setPhone] = useState(initialData?.phone || "");
  const [wantsInvoice, setWantsInvoice] = useState(!!initialData?.wants_invoice);
  const [rfc, setRfc] = useState(initialData?.rfc || "");
  const [thanks, setThanks] = useState(false);

  // Salida discreta para el cajero: 5 toques en el logo dentro de 3 segundos.
  const clicksRef = useRef<number[]>([]);
  const onLogoClick = () => {
    const nowTs = Date.now();
    clicksRef.current = [...clicksRef.current, nowTs].filter(ts => nowTs - ts < 3000);
    if (clicksRef.current.length >= 5) { clicksRef.current = []; onExit(); }
  };

  const submit = () => {
    const clean = {
      name: name.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      rfc: wantsInvoice ? (rfc.trim().toUpperCase() || undefined) : undefined,
      wants_invoice: wantsInvoice,
    };
    setThanks(true);
    setTimeout(() => onReady(clean), 900);
  };

  const skip = () => onReady({});

  const bigInp: React.CSSProperties = {
    width: "100%", padding: "16px 18px", borderRadius: 12,
    border: `2px solid ${t.border}`, background: t.inputBg, color: t.textHi,
    fontSize: 18, outline: "none", boxSizing: "border-box",
    transition: "border-color .15s",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, color: t.textMid, fontWeight: 600, marginBottom: 8, display: "block",
  };

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: `linear-gradient(135deg, ${t.panel} 0%, ${t.panel2} 100%)`,
      display: "flex", flexDirection: "column", overflow: "auto",
    }}>
      <div style={{
        padding: "20px 32px",
        borderBottom: `1px solid ${t.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: t.panel,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }} onClick={onLogoClick}>
          {logoSrc ? (
            <img src={logoSrc} alt="" style={{ height: 48, maxWidth: 140, objectFit: "contain", userSelect: "none" }} />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `linear-gradient(135deg, ${t.nova}, ${t.navy || t.nova})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 20 }}>
              {brandName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.textHi }}>{brandName}</div>
            <div style={{ fontSize: 12, color: t.textLo }}>Bienvenido — captura tus datos si quieres factura o promociones</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderRadius: 999, background: "#A78BFA22", color: "#A78BFA", fontSize: 13, fontWeight: 700 }}>
          <Tablet size={16} /> Modo cliente
        </div>
      </div>

      {thanks ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 40 }}>
          <div style={{ width: 120, height: 120, borderRadius: "50%", background: t.good + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Check size={72} color={t.good} strokeWidth={3} />
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: t.textHi }}>¡Listo!</div>
          <div style={{ fontSize: 17, color: t.textMid }}>Entrega la tablet al cajero para completar tu compra</div>
        </div>
      ) : (
        <div style={{
          flex: 1, display: "grid",
          gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr)",
          gap: 24, padding: 24, maxWidth: 1200, margin: "0 auto", width: "100%",
        }}>
          <div style={{ background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 14, color: t.textLo, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 4 }}>
              Tu compra
            </div>
            <div style={{ fontSize: 15, color: t.textMid, marginBottom: 20 }}>
              {cart.length === 0
                ? "Aún no hay artículos en tu ticket."
                : `${cart.reduce((s, it) => s + it.quantity, 0)} artículo${cart.reduce((s, it) => s + it.quantity, 0) === 1 ? "" : "s"} · ${cart.length} línea${cart.length === 1 ? "" : "s"}`}
            </div>
            <div style={{ flex: 1, overflowY: "auto", maxHeight: 380, paddingRight: 4 }}>
              {cart.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 15 }}>
                  Los productos que escanee el cajero aparecerán aquí en tiempo real.
                </div>
              ) : cart.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${t.border}55` }}>
                  <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                    <div style={{ fontSize: 16, color: t.textHi, fontWeight: 500 }}>{it.product_name}</div>
                    <div style={{ fontSize: 13, color: t.textLo, marginTop: 2 }}>{it.quantity} × {mxn(it.unit_price)}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(it.line_total)}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `2px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 15, color: t.textMid, fontWeight: 700, letterSpacing: 0.5 }}>TOTAL</div>
              <div style={{ fontSize: 42, fontWeight: 900, color: t.textHi, fontVariantNumeric: "tabular-nums", letterSpacing: -1.5 }}>{mxn(total)}</div>
            </div>
          </div>

          <div style={{ background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi, marginBottom: 4 }}>Tus datos</div>
              <div style={{ fontSize: 13.5, color: t.textLo }}>Opcional — solo si quieres factura o quedar en nuestra base para promociones.</div>
            </div>

            <div>
              <label style={labelStyle}>Nombre</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Cómo te llamas"
                autoFocus autoComplete="off"
                onFocus={e => (e.currentTarget.style.borderColor = "#A78BFA")}
                onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                style={bigInp} />
            </div>
            <div>
              <label style={labelStyle}>Correo electrónico</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com"
                autoComplete="off"
                onFocus={e => (e.currentTarget.style.borderColor = "#A78BFA")}
                onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                style={bigInp} />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="10 dígitos"
                inputMode="numeric" autoComplete="off"
                onFocus={e => (e.currentTarget.style.borderColor = "#A78BFA")}
                onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                style={bigInp} />
            </div>

            <button onClick={() => setWantsInvoice(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "14px 18px", borderRadius: 12,
                border: `2px solid ${wantsInvoice ? "#A78BFA" : t.border}`,
                background: wantsInvoice ? "#A78BFA22" : "transparent",
                color: wantsInvoice ? "#A78BFA" : t.textMid,
                cursor: "pointer", fontSize: 15, fontWeight: 700, textAlign: "left",
              }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${wantsInvoice ? "#A78BFA" : t.border}`, background: wantsInvoice ? "#A78BFA" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {wantsInvoice && <Check size={16} color="#fff" strokeWidth={3} />}
              </div>
              Quiero factura CFDI
            </button>

            {wantsInvoice && (
              <div>
                <label style={labelStyle}>RFC</label>
                <input value={rfc} onChange={e => setRfc(e.target.value.toUpperCase())} placeholder="XAXX010101000"
                  maxLength={13} autoComplete="off"
                  onFocus={e => (e.currentTarget.style.borderColor = "#A78BFA")}
                  onBlur={e => (e.currentTarget.style.borderColor = t.border)}
                  style={{ ...bigInp, fontFamily: "monospace", letterSpacing: 1 }} />
                <div style={{ fontSize: 12, color: t.textLo, marginTop: 6 }}>El cajero te pedirá el resto de datos fiscales al facturar.</div>
              </div>
            )}

            <div style={{ flex: 1 }} />

            <button onClick={submit}
              disabled={cart.length === 0}
              style={{
                width: "100%", padding: "20px", borderRadius: 14, border: "none",
                background: cart.length === 0 ? t.panel3 : `linear-gradient(135deg, ${t.good}, #059669)`,
                color: cart.length === 0 ? t.textLo : "#fff",
                fontSize: 20, fontWeight: 800, cursor: cart.length === 0 ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                boxShadow: cart.length === 0 ? "none" : `0 6px 20px ${t.good}66`,
                letterSpacing: 0.3,
              }}>
              <ShieldCheck size={22} /> Listo, pasar al cajero
            </button>
            <button onClick={skip} style={{
              width: "100%", padding: "12px", borderRadius: 12,
              border: `1px solid ${t.border}`, background: "transparent",
              color: t.textLo, fontSize: 14, cursor: "pointer",
            }}>
              No, gracias — solo cobrar
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: "8px 24px", textAlign: "center", fontSize: 11, color: t.textLo, opacity: 0.6, borderTop: `1px solid ${t.border}` }}>
        Cajero: para salir de este modo, toca el logo 5 veces
      </div>
    </div>,
    document.body,
  );
}
