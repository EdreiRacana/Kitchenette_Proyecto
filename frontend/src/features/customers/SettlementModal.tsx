// SettlementModal.tsx — Conciliación de liquidación de marketplace/cadena.
// Corre GET /sales/customers/{id}/settlement y muestra:
//   • Totales: bruto, comisiones, devoluciones, esperado vs depositado, variance
//   • Detalle de órdenes del periodo
//   • Devoluciones aplicadas al depósito

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Calculator, Download, FileSpreadsheet, TrendingUp, TrendingDown, AlertTriangle, RotateCcw, ShoppingBag } from "lucide-react";
import type { Tokens } from "../sales/theme";
import { money } from "../sales/theme";
import { salesApi, type SettlementReport } from "../sales/api";

interface SettlementModalProps {
    tk: Tokens;
    customerId: number;
    customerName: string;
    onClose: () => void;
}

function firstDayOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function toDateInput(d: Date) { return d.toISOString().slice(0, 10); }

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

export default function SettlementModal({ tk, customerId, customerName, onClose }: SettlementModalProps) {
    const today = new Date();
    const [start, setStart] = useState<string>(toDateInput(firstDayOfMonth(today)));
    const [end, setEnd] = useState<string>(toDateInput(lastDayOfMonth(today)));
    const [depositedStr, setDepositedStr] = useState<string>("");
    const [data, setData] = useState<SettlementReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setLoading(true); setError(null);
        try {
            const deposited = depositedStr.trim() === "" ? undefined : Number(depositedStr);
            if (deposited !== undefined && Number.isNaN(deposited)) {
                throw new Error("El monto depositado debe ser un número válido.");
            }
            const params: { start?: string; end?: string; deposited_amount?: number } = {};
            if (start) params.start = new Date(start).toISOString();
            if (end) params.end = new Date(end + "T23:59:59").toISOString();
            if (deposited !== undefined) params.deposited_amount = deposited;
            const res = await salesApi.customerSettlement(customerId, params);
            setData(res);
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || "Error al calcular la conciliación");
            setData(null);
        } finally { setLoading(false); }
    };

    const exportCsv = () => {
        if (!data) return;
        const rows: (string | number)[][] = [];
        rows.push([`Conciliación · ${customerName}`]);
        rows.push([`Periodo`, `${data.period_start || ""} → ${data.period_end || ""}`]);
        rows.push([]);
        rows.push([`Totales`]);
        rows.push([`Venta bruta`, data.totals.gross_sales]);
        rows.push([`Comisiones`, data.totals.commission_total]);
        rows.push([`Neto esperado (antes de devoluciones)`, data.totals.net_expected_before_returns]);
        rows.push([`Devoluciones descontadas`, data.totals.returns_deducted]);
        rows.push([`Esperado a depositar`, data.totals.expected_deposit]);
        rows.push([`Depositado`, data.totals.deposited ?? ""]);
        rows.push([`Variance`, data.totals.variance ?? ""]);
        rows.push([]);
        rows.push([`Órdenes (${data.orders_count})`]);
        rows.push([`Order ID`, `Folio`, `Externo`, `Fecha`, `Bruto`, `Neto al seller`, `Comisión`]);
        for (const o of data.orders) {
            rows.push([o.order_id, o.folio || "", o.external_order_id || "", o.created_at || "",
                       o.gross, o.net_to_seller, o.commission]);
        }
        rows.push([]);
        rows.push([`Devoluciones (${data.returns_count})`]);
        rows.push([`Return ID`, `Folio`, `Order ID`, `Estado`, `Motivo`, `Refund`]);
        for (const r of data.returns) {
            rows.push([r.return_id, r.folio || "", r.order_id, r.status, r.reason || "", r.refund_amount]);
        }
        downloadCSV(`conciliacion_${customerName.replace(/\s+/g, "_")}_${start}_${end}.csv`, rows);
    };

    const inp: React.CSSProperties = {
        padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
        background: tk.panel2, color: tk.textHi, fontSize: 13.5, outline: "none", width: "100%",
    };

    const variance = data?.totals.variance;
    const varianceColor = variance == null ? tk.textLo : Math.abs(variance) < 0.01 ? tk.good : variance > 0 ? tk.warn : tk.bad;
    const varianceLabel = variance == null ? "—" : variance > 0 ? `Sobrante ${money(Math.abs(variance))}` : variance < 0 ? `Faltante ${money(Math.abs(variance))}` : "Cuadra al centavo";

    return createPortal(
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.75)", zIndex: 90, display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 960, maxHeight: "92vh", overflowY: "auto", background: tk.base, border: `1px solid ${tk.border}`, borderRadius: 16, display: "flex", flexDirection: "column" }}>
                {/* Header */}
                <div style={{ padding: "18px 22px", borderBottom: `1px solid ${tk.border}`, background: tk.panel, borderRadius: "16px 16px 0 0", position: "sticky", top: 0, zIndex: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ background: tk.accent + "22", color: tk.accent, borderRadius: 12, padding: 10, display: "flex" }}>
                            <Calculator size={22} />
                        </div>
                        <div>
                            <div style={{ fontSize: 17, fontWeight: 800, color: tk.textHi }}>Conciliar liquidación</div>
                            <div style={{ fontSize: 13, color: tk.textLo, marginTop: 2 }}>{customerName}</div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "transparent", border: "none", color: tk.textLo, cursor: "pointer", padding: 4 }}>
                        <X size={22} />
                    </button>
                </div>

                {/* Filtros */}
                <div style={{ padding: 20, borderBottom: `1px solid ${tk.border}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr auto auto", gap: 10, alignItems: "end" }}>
                        <div>
                            <label style={{ display: "block", fontSize: 11, color: tk.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Desde</label>
                            <input type="date" value={start} onChange={e => setStart(e.target.value)} style={inp} />
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: 11, color: tk.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Hasta</label>
                            <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inp} />
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: 11, color: tk.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Monto depositado (opcional)</label>
                            <input type="number" step="0.01" placeholder="Ej. 15,342.50"
                                value={depositedStr} onChange={e => setDepositedStr(e.target.value)} style={inp} />
                        </div>
                        <button onClick={run} disabled={loading}
                            style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: tk.accent, color: "#06122B", cursor: loading ? "wait" : "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, opacity: loading ? 0.7 : 1 }}>
                            <Calculator size={14} /> {loading ? "Calculando…" : "Conciliar"}
                        </button>
                        <button onClick={exportCsv} disabled={!data}
                            style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, cursor: data ? "pointer" : "not-allowed", opacity: data ? 1 : 0.5, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                            <Download size={14} /> CSV
                        </button>
                    </div>
                    <div style={{ fontSize: 11.5, color: tk.textLo, marginTop: 10 }}>
                        Compara órdenes marketplace (net_to_seller) menos devoluciones vs el depósito recibido para detectar faltantes.
                    </div>
                </div>

                {error && (
                    <div style={{ margin: 20, padding: "10px 14px", background: tk.bad + "18", border: `1px solid ${tk.bad}44`, color: tk.bad, borderRadius: 10, fontSize: 13 }}>
                        {error}
                    </div>
                )}

                {loading && !data && (
                    <div style={{ padding: 40, textAlign: "center", color: tk.textLo, fontSize: 13 }}>
                        Calculando conciliación…
                    </div>
                )}

                {!data && !loading && !error && (
                    <div style={{ padding: 40, textAlign: "center", color: tk.textLo, fontSize: 13 }}>
                        <FileSpreadsheet size={30} color={tk.textLo} style={{ marginBottom: 10 }} />
                        <div style={{ fontSize: 14, fontWeight: 600, color: tk.textMid }}>Elige un rango y presiona "Conciliar"</div>
                    </div>
                )}

                {data && (
                    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                        {/* Totales */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                            {[
                                { label: "Venta bruta", value: money(data.totals.gross_sales), color: tk.accent, sub: `${data.orders_count} órdenes` },
                                { label: "Comisiones", value: money(data.totals.commission_total), color: tk.warn, sub: "retenidas por la plataforma" },
                                { label: "Devoluciones", value: money(data.totals.returns_deducted), color: tk.bad, sub: `${data.returns_count} devoluciones` },
                                { label: "Esperado a depositar", value: money(data.totals.expected_deposit), color: tk.good, sub: "neto − devoluciones" },
                                { label: "Depositado", value: data.totals.deposited != null ? money(data.totals.deposited) : "—", color: tk.textHi, sub: "capturado por ti" },
                            ].map(k => (
                                <div key={k.label} style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "12px 14px" }}>
                                    <div style={{ fontSize: 11, color: tk.textLo, marginBottom: 3 }}>{k.label}</div>
                                    <div style={{ fontSize: 17, fontWeight: 800, color: k.color, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                                    <div style={{ fontSize: 10.5, color: tk.textLo, marginTop: 2 }}>{k.sub}</div>
                                </div>
                            ))}
                        </div>

                        {/* Variance */}
                        <div style={{ background: varianceColor + "18", border: `1px solid ${varianceColor}55`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                            {variance == null ? <FileSpreadsheet size={22} color={varianceColor} /> :
                                Math.abs(variance) < 0.01 ? <TrendingUp size={22} color={varianceColor} /> :
                                    variance > 0 ? <TrendingUp size={22} color={varianceColor} /> :
                                        <TrendingDown size={22} color={varianceColor} />}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, color: tk.textLo, marginBottom: 2 }}>Diferencia (depositado − esperado)</div>
                                <div style={{ fontSize: 17, fontWeight: 800, color: varianceColor }}>
                                    {varianceLabel}
                                </div>
                            </div>
                            {variance != null && variance < -0.01 && (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, color: varianceColor, fontSize: 12, fontWeight: 600 }}>
                                    <AlertTriangle size={14} /> Reclamar al marketplace
                                </div>
                            )}
                        </div>

                        {/* Órdenes */}
                        <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
                            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${tk.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                                <ShoppingBag size={15} color={tk.accent} />
                                <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi }}>Órdenes del periodo</div>
                                <span style={{ marginLeft: "auto", fontSize: 12, color: tk.textLo }}>{data.orders.length}</span>
                            </div>
                            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                                    <thead>
                                        <tr style={{ background: tk.panel2, position: "sticky", top: 0 }}>
                                            {["Folio", "Externo", "Fecha", "Bruto", "Neto seller", "Comisión"].map((h, i) => (
                                                <th key={i} style={{ padding: "9px 12px", textAlign: i > 2 ? "right" : "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.orders.length === 0 && (
                                            <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: tk.textLo, fontSize: 13 }}>Sin órdenes en este periodo</td></tr>
                                        )}
                                        {data.orders.slice(0, 200).map((o, i) => (
                                            <tr key={o.order_id} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                                                <td style={{ padding: "9px 12px", fontSize: 12.5, color: tk.accent, fontFamily: "monospace", fontWeight: 600 }}>{o.folio || `#${o.order_id}`}</td>
                                                <td style={{ padding: "9px 12px", fontSize: 12, color: tk.textLo, fontFamily: "monospace" }}>{o.external_order_id || "—"}</td>
                                                <td style={{ padding: "9px 12px", fontSize: 12, color: tk.textMid }}>{o.created_at ? new Date(o.created_at).toLocaleDateString("es-MX") : "—"}</td>
                                                <td style={{ padding: "9px 12px", fontSize: 13, color: tk.textHi, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(o.gross)}</td>
                                                <td style={{ padding: "9px 12px", fontSize: 13, color: tk.good, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(o.net_to_seller)}</td>
                                                <td style={{ padding: "9px 12px", fontSize: 12.5, color: tk.warn, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(o.commission)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {data.orders.length > 200 && (
                                <div style={{ padding: "8px 16px", fontSize: 11.5, color: tk.textLo, borderTop: `1px solid ${tk.border}` }}>
                                    Mostrando 200 de {data.orders.length}. Descarga el CSV para ver todo el detalle.
                                </div>
                            )}
                        </div>

                        {/* Devoluciones */}
                        {data.returns.length > 0 && (
                            <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
                                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${tk.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                                    <RotateCcw size={15} color={tk.bad} />
                                    <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi }}>Devoluciones descontadas</div>
                                    <span style={{ marginLeft: "auto", fontSize: 12, color: tk.textLo }}>{data.returns.length}</span>
                                </div>
                                <div style={{ overflowX: "auto", maxHeight: 240, overflowY: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                                        <thead>
                                            <tr style={{ background: tk.panel2, position: "sticky", top: 0 }}>
                                                {["Folio", "Order", "Estado", "Motivo", "Reembolso"].map((h, i) => (
                                                    <th key={i} style={{ padding: "9px 12px", textAlign: i === 4 ? "right" : "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.returns.map((r, i) => (
                                                <tr key={r.return_id} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                                                    <td style={{ padding: "9px 12px", fontSize: 12.5, color: tk.accent, fontFamily: "monospace", fontWeight: 600 }}>{r.folio || `#${r.return_id}`}</td>
                                                    <td style={{ padding: "9px 12px", fontSize: 12.5, color: tk.textMid }}>#{r.order_id}</td>
                                                    <td style={{ padding: "9px 12px", fontSize: 12, color: tk.textLo }}>{r.status}</td>
                                                    <td style={{ padding: "9px 12px", fontSize: 12, color: tk.textMid }}>{r.reason || "—"}</td>
                                                    <td style={{ padding: "9px 12px", fontSize: 13, color: tk.bad, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(r.refund_amount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
