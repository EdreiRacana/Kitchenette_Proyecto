// POSModule.tsx — Punto de venta profesional
// Flujo: seleccionar terminal → abrir turno → vender → arqueo/cerrar
// Pensado para tablet/pantalla táctil pero funciona con teclado + lector.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Store, ShoppingCart, DollarSign, Plus, Minus, Trash2, Search,
  Lock, Unlock, LogIn, LogOut, Printer, RefreshCw, Package, Download,
  Banknote, CreditCard, ArrowLeftRight, Check, X, AlertTriangle,
  Receipt, User, Clock, ChevronRight,
} from "lucide-react";
import { posApi, DENOMINATIONS, type POSTerminal, type POSSession, type POSProduct, type POSSaleItem, type SessionSale } from "./api";

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
      <h1 style={{ margin: 0, fontSize: 24, color: t.textHi }}>Punto de venta</h1>
      <p style={{ color: t.textLo, fontSize: 13, marginTop: 4 }}>Selecciona la caja y captura el fondo inicial para abrir el turno.</p>

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
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await posApi.searchProducts(query, 20);
        setResults(r);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const addToCart = (p: POSProduct) => {
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
    setQuery(""); setResults([]);
    searchRef.current?.focus();
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", height: "calc(100vh - 90px)", gap: 12, padding: 12 }}>
      {/* Panel izquierdo: búsqueda + resultados */}
      <div style={{ background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, background: t.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Store size={16} color={t.nova} />
            <div>
              <div style={{ fontSize: 12.5, color: t.textHi, fontWeight: 700 }}>{session.terminal_name}</div>
              <div style={{ fontSize: 10.5, color: t.textLo }}>Cajero: {session.cashier_name}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowHistory(true)}
              title="Ver historial de ventas del turno (reimprimir tickets)"
              style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.nova}55`, background: t.nova + "18", color: t.nova, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
              <Receipt size={12} /> Ventas del turno
            </button>
            <button onClick={() => setShowCash("cash_in")}
              style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <Plus size={12} /> Fondo
            </button>
            <button onClick={() => setShowCash("cash_out")}
              style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <Minus size={12} /> Retiro
            </button>
            <button onClick={() => setShowClose(true)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
              <Lock size={12} /> Cerrar turno
            </button>
          </div>
        </div>

        <div style={{ padding: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={16} color={t.textLo} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Escanea código de barras, teclea SKU o nombre…"
              autoFocus
              style={{ width: "100%", padding: "12px 14px 12px 38px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14, outline: "none" }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {results.length === 0 && !searching && (
            <div style={{ padding: "60px 20px", textAlign: "center", color: t.textLo }}>
              <Package size={36} style={{ opacity: 0.35, marginBottom: 10 }} />
              <div style={{ fontSize: 13 }}>Escanea o busca un producto para empezar</div>
            </div>
          )}
          {searching && <div style={{ padding: 20, color: t.textLo, fontSize: 12 }}>Buscando…</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {results.map(p => (
              <button key={p.variant_id} onClick={() => addToCart(p)}
                style={{ textAlign: "left", padding: 12, borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, lineHeight: 1.3 }}>{p.product_name}</div>
                {p.sku && <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 3, fontFamily: "monospace" }}>{p.sku}</div>}
                <div style={{ fontSize: 15, fontWeight: 800, color: t.good, marginTop: 8 }}>{mxn(p.unit_price)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Panel derecho: carrito + totales */}
      <div style={{ background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, background: t.panel2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShoppingCart size={18} color={t.nova} />
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>Carrito ({cart.length})</div>
          </div>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <Trash2 size={12} /> Vaciar
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {cart.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>Carrito vacío</div>
          )}
          {cart.map((it, i) => (
            <div key={i} style={{ padding: "10px 12px", borderBottom: `1px solid ${t.border}55`, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.product_name}</div>
                <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{mxn(it.unit_price)} × {it.quantity}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <button onClick={() => changeQty(i, -1)} style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: "pointer" }}><Minus size={12} /></button>
                <div style={{ minWidth: 24, textAlign: "center", fontSize: 13, fontWeight: 700, color: t.textHi }}>{it.quantity}</div>
                <button onClick={() => changeQty(i, 1)} style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid ${t.border}`, background: t.panel3, color: t.textMid, cursor: "pointer" }}><Plus size={12} /></button>
                <button onClick={() => removeLine(i)} style={{ width: 24, height: 24, borderRadius: 5, border: "none", background: "transparent", color: t.bad, cursor: "pointer", marginLeft: 4 }}><Trash2 size={12} /></button>
              </div>
              <div style={{ minWidth: 80, textAlign: "right", fontSize: 13, fontWeight: 700, color: t.textHi }}>{mxn(it.line_total)}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: 16, borderTop: `1px solid ${t.border}`, background: t.panel2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.textMid, marginBottom: 4 }}>
            <span>Subtotal</span><span>{mxn(subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 800, color: t.textHi, marginTop: 6 }}>
            <span>TOTAL</span><span>{mxn(total)}</span>
          </div>
          <button disabled={cart.length === 0} onClick={() => setShowPay(true)}
            style={{ marginTop: 14, width: "100%", padding: 16, borderRadius: 10, border: "none",
              background: cart.length === 0 ? t.panel3 : `linear-gradient(135deg, ${t.good}, #059669)`,
              color: "#fff", fontSize: 15, fontWeight: 800, cursor: cart.length === 0 ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <DollarSign size={18} /> Cobrar {mxn(total)}
          </button>
        </div>
      </div>

      {showPay && <PayModal t={t} session={session} total={total} cart={cart}
        onDone={(sale) => { setCart([]); setShowPay(false); setLastSale(sale); setHistoryRefresh(v => v + 1); }}
        onCancel={() => setShowPay(false)} />}
      {showHistory && <SalesHistoryDrawer t={t} session={session} refreshKey={historyRefresh}
        onClose={() => setShowHistory(false)} />}
      {showClose && <CloseSessionModal t={t} session={session}
        onClosed={() => { setShowClose(false); onClosed(); }} onCancel={() => setShowClose(false)} />}
      {showCash && <CashMovementModal t={t} session={session} type={showCash}
        onDone={() => setShowCash(null)} onCancel={() => setShowCash(null)} />}
      {lastSale && <SaleSuccessModal t={t} sale={lastSale} onClose={() => setLastSale(null)} />}
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
function PayModal({ t, session, total, cart, onDone, onCancel }: any) {
  // Sólo el efectivo puede exceder el total (para calcular cambio). Tarjeta y
  // transferencia deben ser exactos: si el cajero teclea $500 en tarjeta, el
  // sistema NO debe cobrar los $500 de efectivo también — este bug provocaba
  // que ambos métodos aparecieran duplicados en el ticket.
  const [card, setCard] = useState<number>(0);
  const [transfer, setTransfer] = useState<number>(0);
  const [cash, setCash] = useState<number>(total);
  const [cashEdited, setCashEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  // Auto-balance: mientras el cajero no toque el efectivo, éste refleja
  // exactamente lo que falta cubrir con tarjeta/transferencia.
  useEffect(() => {
    if (!cashEdited) {
      setCash(Math.max(0, Math.round((total - card - transfer) * 100) / 100));
    }
  }, [total, card, transfer, cashEdited]);

  const paid = cash + card + transfer;
  const change = paid - total;
  const submit = async () => {
    setSaving(true);
    try {
      const payments: Record<string, number> = {};
      // Tarjeta/transferencia: se cobra el monto exacto tecleado.
      if (card > 0) payments.card = Math.round(card * 100) / 100;
      if (transfer > 0) payments.transfer = Math.round(transfer * 100) / 100;
      // Efectivo: cobra sólo lo que faltaba después de los electrónicos,
      // pero registra el monto físico recibido para calcular cambio.
      const nonCash = (payments.card || 0) + (payments.transfer || 0);
      const cashDue = Math.max(0, Math.round((total - nonCash) * 100) / 100);
      if (cash > 0 && cashDue > 0) {
        // Registrar el efectivo real recibido (para arqueo), no el "debido".
        payments.cash = Math.round(cash * 100) / 100;
      }
      const res = await posApi.registerSale({
        session_id: session.id, customer_id: undefined,
        items: cart.map((it: any) => ({
          variant_id: it.variant_id, product_name: it.product_name, sku: it.sku,
          quantity: it.quantity, unit_price: it.unit_price,
          discount_amount: it.discount_amount || 0, tax_rate: it.tax_rate || 16,
          is_service: it.is_service || false,
        })),
        payments, tax_rate: 16,
      });
      onDone(res);
    } catch (e: any) { alert(e?.response?.data?.detail || "Error al cobrar"); }
    finally { setSaving(false); }
  };
  return (
    <div style={modalBg} onClick={onCancel}>
      <div style={{ ...modalPane, background: t.panel, border: `1px solid ${t.border}` }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 20, borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 12, color: t.textLo }}>Total a cobrar</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(total)}</div>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { l: "Efectivo", ic: Banknote, val: cash, c: t.good, key: "cash" as const,
              set: (v: number) => { setCash(v); setCashEdited(true); },
              hint: cashEdited ? "Manual" : "Auto",
            },
            { l: "Tarjeta", ic: CreditCard, val: card, c: t.nova, key: "card" as const,
              set: setCard, hint: null,
            },
            { l: "Transferencia", ic: ArrowLeftRight, val: transfer, c: "#8E7BB8", key: "transfer" as const,
              set: setTransfer, hint: null,
            },
          ].map(row => (
            <div key={row.l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: row.c + "22", color: row.c, display: "grid", placeItems: "center" }}>
                <row.ic size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: t.textLo, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{row.l}</span>
                  {row.hint && (
                    <span style={{ fontSize: 9.5, color: cashEdited ? t.warn : t.good, background: (cashEdited ? t.warn : t.good) + "22", padding: "1px 6px", borderRadius: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{row.hint}</span>
                  )}
                </div>
                <input type="number" step={0.01} min={0} value={row.val || ""} onChange={e => row.set(parseFloat(e.target.value) || 0)}
                  onFocus={e => e.target.select()}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 15, fontWeight: 700, marginTop: 3 }} />
              </div>
            </div>
          ))}
          {cashEdited && (
            <button onClick={() => setCashEdited(false)} type="button"
              style={{ alignSelf: "flex-start", background: "transparent", border: "none", color: t.nova, fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
              Volver a auto-balance del efectivo
            </button>
          )}
          <div style={{ marginTop: 6, padding: 14, background: change >= 0 ? t.good + "18" : t.bad + "18", borderRadius: 10, border: `1px solid ${change >= 0 ? t.good : t.bad}55` }}>
            <div style={{ fontSize: 12, color: t.textLo }}>{change >= 0 ? "Cambio a entregar" : "Falta"}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: change >= 0 ? t.good : t.bad }}>{mxn(Math.abs(change))}</div>
          </div>
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer" }}>Cancelar</button>
          <button disabled={saving || paid < total - 0.005} onClick={submit}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: paid < total - 0.005 ? t.panel3 : `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: paid < total - 0.005 ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {saving ? "Procesando…" : "Confirmar venta"}
          </button>
        </div>
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
