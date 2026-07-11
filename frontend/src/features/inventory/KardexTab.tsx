// KardexTab.tsx — Kardex FIFO: movimientos cronológicos con saldo y costo
// promedio en cada punto. Selector de SKU + almacén + rango de fechas.

import { useState, useMemo, useEffect } from "react";
import { Search, RefreshCw, Download, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Info } from "lucide-react";
import { inventoryService, type Product, type Warehouse, type KardexResult } from "./service";

const mxn = (n: number) => "$" + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => (Number(n) || 0).toLocaleString("es-MX");

const csvEscape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const glass = (t: any): React.CSSProperties =>
    t?.name === "dark"
        ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: `1px solid ${t.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }
        : { background: t.panel, border: `1px solid ${t.border}` };

interface KardexTabProps {
    t: any;
    lang: "es" | "en";
    products: Product[];
    warehouses: Warehouse[];
}

export default function KardexTab({ t, lang, products, warehouses }: KardexTabProps) {
    const [variantId, setVariantId] = useState<number | null>(null);
    const [warehouseId, setWarehouseId] = useState<number | "">("");
    const [start, setStart] = useState<string>("");
    const [end, setEnd] = useState<string>("");
    const [q, setQ] = useState("");
    const [data, setData] = useState<KardexResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Todos los variants con nombre del producto
    const variants = useMemo(() =>
        products.flatMap(p => p.variants.map(v => ({
            id: v.id, sku: v.sku, product_name: p.name,
            label: `${v.sku} — ${p.name}`,
        }))), [products]);

    const filteredVariants = useMemo(() => {
        if (!q) return variants.slice(0, 80);
        const qs = q.toLowerCase();
        return variants.filter(v =>
            v.sku.toLowerCase().includes(qs) || v.product_name.toLowerCase().includes(qs)
        ).slice(0, 80);
    }, [variants, q]);

    const selectedVariant = useMemo(() =>
        variants.find(v => v.id === variantId) || null, [variants, variantId]);

    const warehouseName = (id: number | null | undefined) => {
        if (!id) return "—";
        const w = warehouses.find(x => x.id === id);
        return w?.name || `#${id}`;
    };

    const load = async () => {
        if (!variantId) return;
        setLoading(true); setError(null);
        try {
            const params: any = {};
            if (warehouseId) params.warehouse_id = warehouseId;
            if (start) params.start = new Date(start).toISOString();
            if (end) params.end = new Date(end + "T23:59:59").toISOString();
            params.limit = 500;
            const res = await inventoryService.getKardex(variantId, params);
            setData(res);
        } catch (e: any) {
            setError(e?.message || (lang === "es" ? "Error al cargar el kardex" : "Failed to load kardex"));
            setData(null);
        } finally { setLoading(false); }
    };

    // Auto-load al elegir un SKU
    useEffect(() => { if (variantId) load(); /* eslint-disable-next-line */ }, [variantId, warehouseId]);

    const exportCsv = () => {
        if (!data) return;
        const header = [
            lang === "es" ? "Fecha" : "Date",
            lang === "es" ? "Tipo" : "Type",
            lang === "es" ? "Almacén" : "Warehouse",
            lang === "es" ? "Cantidad" : "Quantity",
            lang === "es" ? "Costo unitario" : "Unit cost",
            lang === "es" ? "Referencia" : "Reference",
            lang === "es" ? "Saldo" : "Balance",
            lang === "es" ? "Valor inventario" : "Inventory value",
            lang === "es" ? "Costo promedio" : "Avg cost",
        ];
        const rows = data.movements.map(m => [
            new Date(m.created_at).toLocaleString("es-MX"),
            m.movement_type,
            warehouseName(m.warehouse_id ?? null),
            m.quantity,
            m.unit_cost,
            m.reference || "",
            m.balance,
            m.inv_value,
            m.avg_cost,
        ]);
        const filename = `kardex_${selectedVariant?.sku || variantId}_${new Date().toISOString().slice(0, 10)}.csv`;
        downloadCSV(filename, [header, ...rows]);
    };

    const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Selector */}
            <div style={{ ...glass(t), borderRadius: 12, padding: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                    <div>
                        <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                            {lang === "es" ? "SKU / producto" : "SKU / product"}
                        </label>
                        <div style={{ position: "relative" }}>
                            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
                            <input value={q} onChange={e => setQ(e.target.value)}
                                placeholder={lang === "es" ? "Buscar por SKU o nombre…" : "Search by SKU or name…"}
                                style={{ ...inp, paddingLeft: 32, width: "100%" }} />
                        </div>
                        {q && filteredVariants.length > 0 && (
                            <div style={{ marginTop: 6, maxHeight: 180, overflowY: "auto", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8 }}>
                                {filteredVariants.map(v => (
                                    <div key={v.id}
                                        onClick={() => { setVariantId(v.id); setQ(""); }}
                                        style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12.5, color: t.textMid, borderBottom: `1px solid ${t.borderSoft}` }}
                                        onMouseEnter={e => (e.currentTarget.style.background = t.panel3)}
                                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                        <span style={{ color: t.nova, fontFamily: "monospace", fontWeight: 600 }}>{v.sku}</span>
                                        <span style={{ marginLeft: 8, color: t.textHi }}>{v.product_name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {selectedVariant && !q && (
                            <div style={{ marginTop: 6, fontSize: 12, color: t.textMid }}>
                                <span style={{ color: t.nova, fontFamily: "monospace", fontWeight: 600 }}>{selectedVariant.sku}</span>
                                <span style={{ marginLeft: 8, color: t.textHi }}>{selectedVariant.product_name}</span>
                            </div>
                        )}
                    </div>
                    <div>
                        <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                            {lang === "es" ? "Almacén" : "Warehouse"}
                        </label>
                        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : "")}
                            style={{ ...inp, width: "100%", cursor: "pointer" }}>
                            <option value="">{lang === "es" ? "Todos" : "All"}</option>
                            {warehouses.filter(w => w.is_active).map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                            {lang === "es" ? "Desde" : "From"}
                        </label>
                        <input type="date" value={start} onChange={e => setStart(e.target.value)}
                            style={{ ...inp, width: "100%" }} />
                    </div>
                    <div>
                        <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                            {lang === "es" ? "Hasta" : "To"}
                        </label>
                        <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                            style={{ ...inp, width: "100%" }} />
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={load} disabled={!variantId || loading}
                            style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: variantId ? "pointer" : "not-allowed", opacity: variantId ? 1 : 0.5, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                            <RefreshCw size={13} /> {lang === "es" ? "Consultar" : "Query"}
                        </button>
                        <button onClick={exportCsv} disabled={!data}
                            style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: data ? "pointer" : "not-allowed", opacity: data ? 1 : 0.5, fontSize: 12.5, display: "flex", alignItems: "center", gap: 5 }}>
                            <Download size={13} /> CSV
                        </button>
                    </div>
                </div>
            </div>

            {/* Empty state */}
            {!variantId && (
                <div style={{ ...glass(t), borderRadius: 12, padding: 40, textAlign: "center" }}>
                    <SlidersHorizontal size={28} color={t.textLo} style={{ marginBottom: 10 }} />
                    <div style={{ fontSize: 14, color: t.textMid, fontWeight: 600 }}>
                        {lang === "es" ? "Selecciona un SKU para ver su kardex" : "Select a SKU to view its kardex"}
                    </div>
                    <div style={{ fontSize: 12, color: t.textLo, marginTop: 4 }}>
                        {lang === "es" ? "Movimientos cronológicos con costo aplicado FIFO y saldo acumulado" : "Chronological movements with FIFO-applied cost and running balance"}
                    </div>
                </div>
            )}

            {error && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
                    <Info size={16} /> {error}
                </div>
            )}

            {/* KPIs de resumen */}
            {data && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                    {[
                        { label: lang === "es" ? "Saldo actual" : "Current balance", value: num(data.current_balance), color: data.current_balance > 0 ? t.good : t.bad, sub: lang === "es" ? "unidades" : "units" },
                        { label: lang === "es" ? "Valor inventario" : "Inventory value", value: mxn(data.current_inventory_value), color: t.nova, sub: lang === "es" ? "al costo FIFO" : "at FIFO cost" },
                        { label: lang === "es" ? "Costo promedio" : "Avg cost", value: mxn(data.current_avg_cost), color: t.warn, sub: lang === "es" ? "unitario ponderado" : "weighted unit" },
                        { label: lang === "es" ? "Total entradas" : "Total received", value: num(data.total_received), color: t.good, sub: lang === "es" ? "unidades" : "units" },
                        { label: lang === "es" ? "Total salidas" : "Total shipped", value: num(data.total_shipped), color: t.bad, sub: lang === "es" ? "unidades" : "units" },
                    ].map(k => (
                        <div key={k.label} style={{ ...glass(t), borderRadius: 12, padding: "12px 14px" }}>
                            <div style={{ fontSize: 11, color: t.textLo, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: k.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.value}</div>
                            <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2 }}>{k.sub}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Tabla */}
            {data && (
                <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: t.textHi }}>
                            {lang === "es" ? "Movimientos" : "Movements"}
                            <span style={{ marginLeft: 8, color: t.textLo, fontWeight: 400 }}>({data.movements.length})</span>
                        </div>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                            <thead>
                                <tr style={{ background: t.panel2 }}>
                                    {[
                                        lang === "es" ? "Fecha" : "Date",
                                        lang === "es" ? "Tipo" : "Type",
                                        lang === "es" ? "Almacén" : "Warehouse",
                                        lang === "es" ? "Cantidad" : "Qty",
                                        lang === "es" ? "Costo unit." : "Unit cost",
                                        lang === "es" ? "Referencia" : "Reference",
                                        lang === "es" ? "Saldo" : "Balance",
                                        lang === "es" ? "Valor inv." : "Inv. value",
                                        lang === "es" ? "Costo prom." : "Avg cost",
                                    ].map((h, i) => (
                                        <th key={i} style={{ padding: "10px 12px", textAlign: i > 2 ? "right" : "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 13 }}>{lang === "es" ? "Cargando…" : "Loading…"}</td></tr>
                                )}
                                {!loading && data.movements.length === 0 && (
                                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 13 }}>
                                        {lang === "es" ? "Sin movimientos en el período seleccionado" : "No movements in the selected period"}
                                    </td></tr>
                                )}
                                {!loading && data.movements.map((m, i) => {
                                    const isIn = m.quantity > 0;
                                    const isOut = m.quantity < 0;
                                    const rowBg = i % 2 === 0 ? t.panel : t.panel2;
                                    return (
                                        <tr key={m.id} style={{ background: rowBg }}>
                                            <td style={{ padding: "10px 12px", fontSize: 12, color: t.textMid, whiteSpace: "nowrap" }}>
                                                {new Date(m.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                                            </td>
                                            <td style={{ padding: "10px 12px" }}>
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: isIn ? t.good : isOut ? t.bad : t.warn, background: (isIn ? t.good : isOut ? t.bad : t.warn) + "18", padding: "3px 9px", borderRadius: 20 }}>
                                                    {isIn ? <ArrowDownToLine size={11} /> : isOut ? <ArrowUpFromLine size={11} /> : <SlidersHorizontal size={11} />}
                                                    {(m.movement_type || "").toUpperCase()}
                                                </span>
                                            </td>
                                            <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid }}>{warehouseName(m.warehouse_id ?? null)}</td>
                                            <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: isIn ? t.good : t.bad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                                {isIn ? "+" : ""}{num(m.quantity)}
                                            </td>
                                            <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(m.unit_cost)}</td>
                                            <td style={{ padding: "10px 12px", fontSize: 11.5, color: t.textLo, fontFamily: "monospace" }}>{m.reference || "—"}</td>
                                            <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: t.textHi, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(m.balance)}</td>
                                            <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(m.inv_value)}</td>
                                            <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.warn, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(m.avg_cost)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
