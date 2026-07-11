// POSModule.tsx — Punto de venta profesional
// Flujo: seleccionar terminal → abrir turno → vender → arqueo/cerrar
// Pensado para tablet/pantalla táctil pero funciona con teclado + lector.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Store, ShoppingCart, DollarSign, Plus, Minus, Trash2, Search,
  Lock, Unlock, LogIn, LogOut, Printer, RefreshCw, Package,
  Banknote, CreditCard, ArrowLeftRight, Check, X, AlertTriangle,
} from "lucide-react";
import { posApi, DENOMINATIONS, type POSTerminal, type POSSession, type POSProduct, type POSSaleItem } from "./api";

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
        onDone={(sale) => { setCart([]); setShowPay(false); setLastSale(sale); setTimeout(() => setLastSale(null), 6000); }}
        onCancel={() => setShowPay(false)} />}
      {showClose && <CloseSessionModal t={t} session={session}
        onClosed={() => { setShowClose(false); onClosed(); }} onCancel={() => setShowClose(false)} />}
      {showCash && <CashMovementModal t={t} session={session} type={showCash}
        onDone={() => setShowCash(null)} onCancel={() => setShowCash(null)} />}
      {lastSale && (
        <div style={{ position: "fixed", top: 16, right: 16, background: t.good + "22", border: `1px solid ${t.good}`, borderRadius: 10, padding: "14px 18px", zIndex: 90, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
          <Check size={20} color={t.good} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>Venta {lastSale.folio}</div>
            <div style={{ fontSize: 11.5, color: t.textLo }}>Total {mxn(lastSale.total_amount)} — Cambio {mxn(lastSale.change || 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Modales ─────────────────────────────────────────────────────────
function PayModal({ t, session, total, cart, onDone, onCancel }: any) {
  const [cash, setCash] = useState<number>(total);
  const [card, setCard] = useState<number>(0);
  const [transfer, setTransfer] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const paid = cash + card + transfer;
  const change = paid - total;
  const submit = async () => {
    setSaving(true);
    try {
      const payments: Record<string, number> = {};
      if (cash > 0) payments.cash = cash;
      if (card > 0) payments.card = card;
      if (transfer > 0) payments.transfer = transfer;
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
            { l: "Efectivo", ic: Banknote, val: cash, set: setCash, c: t.good },
            { l: "Tarjeta", ic: CreditCard, val: card, set: setCard, c: t.nova },
            { l: "Transferencia", ic: ArrowLeftRight, val: transfer, set: setTransfer, c: "#8E7BB8" },
          ].map(row => (
            <div key={row.l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: row.c + "22", color: row.c, display: "grid", placeItems: "center" }}>
                <row.ic size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: t.textLo }}>{row.l}</div>
                <input type="number" step={0.01} min={0} value={row.val} onChange={e => row.set(parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 15, fontWeight: 700, marginTop: 3 }} />
              </div>
            </div>
          ))}
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
              alert(
                `Turno cerrado.\n\n`
                + `Esperado: ${mxn(closed.expected_cash)}\n`
                + `Contado:  ${mxn(closed.actual_cash)}\n`
                + `Diferencia: ${closed.variance >= 0 ? "+" : ""}${mxn(closed.variance)}\n\n`
                + `Ventas: ${closed.total_sales_count} · ${mxn(closed.total_sales_amount)}`
              );
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
