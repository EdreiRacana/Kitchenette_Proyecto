// Cédulas IMSS / SAR / INFONAVIT — apoyo para SUA (Sistema Único de Autodeterminación).
// Tab con dos vistas: Mensual (EGM/IV/GPS/RT) y Bimestral (Retiro/CV/INFONAVIT).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Download, RefreshCw, Building2, Users, DollarSign, Calendar,
} from "lucide-react";
import { hrApi } from "./api";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mxn0 = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
               "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const BIMESTRES = [
  { n: 1, label: "1er (Ene-Feb)" },
  { n: 2, label: "2do (Mar-Abr)" },
  { n: 3, label: "3ro (May-Jun)" },
  { n: 4, label: "4to (Jul-Ago)" },
  { n: 5, label: "5to (Sep-Oct)" },
  { n: 6, label: "6to (Nov-Dic)" },
];

export default function CedulasImssTab({ t }: { t: any }) {
  const now = new Date();
  const [kind, setKind] = useState<"mensual" | "bimestral">("mensual");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bimester, setBimester] = useState(Math.ceil((now.getMonth() + 1) / 2));
  const [primaRt, setPrimaRt] = useState<number | "">("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const d = kind === "mensual"
        ? await hrApi.cedulaImssMensual(year, month, primaRt ? Number(primaRt) : undefined)
        : await hrApi.cedulaBimestral(year, bimester);
      setData(d);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar cédula");
    } finally { setLoading(false); }
  }, [kind, year, month, bimester, primaRt]);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear(); y >= 2020; y--) arr.push(y);
    return arr;
  }, [now]);

  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
  };

  const ramosOrd = kind === "mensual"
    ? ["em_especie_cuota_fija", "em_especie_excedente", "em_dinero", "iv", "gps", "rt_default"]
    : ["retiro", "cv", "infonavit_aportacion"];

  const totalPagar = kind === "mensual"
    ? (data?.totals?.total_pagar_imss || 0)
    : ((data?.totals?.total_patron || 0)
        + (data?.totals?.total_obrero || 0)
        + (data?.totals?.total_infonavit_descuento || 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, color: t.textHi, fontSize: 18, fontWeight: 700 }}>Cédulas IMSS / SAR / INFONAVIT</h2>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>
            Cédula de apoyo para capturar/validar cuotas en el <b>SUA</b> del IMSS. Pago límite: día 17 del mes siguiente al periodo.
          </p>
        </div>
      </div>

      {/* Selector */}
      <div style={{ ...glass, padding: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, background: t.panel2, padding: 4, borderRadius: 10, border: `1px solid ${t.border}` }}>
            <button onClick={() => setKind("mensual")} style={{
              padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
              background: kind === "mensual" ? t.nova : "transparent",
              color: kind === "mensual" ? "#fff" : t.textMid,
              fontWeight: 600, fontSize: 13,
            }}>Mensual (IMSS)</button>
            <button onClick={() => setKind("bimestral")} style={{
              padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
              background: kind === "bimestral" ? t.nova : "transparent",
              color: kind === "bimestral" ? "#fff" : t.textMid,
              fontWeight: 600, fontSize: 13,
            }}>Bimestral (SAR / INFONAVIT)</button>
          </div>

          <div>
            <label style={lbl(t)}>Año</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={inp(t)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {kind === "mensual" && (
            <>
              <div>
                <label style={lbl(t)}>Mes</label>
                <select value={month} onChange={e => setMonth(Number(e.target.value))} style={inp(t)}>
                  {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl(t)}>Prima RT (opcional)</label>
                <input type="number" step="0.0001" value={primaRt}
                  onChange={e => setPrimaRt(e.target.value ? Number(e.target.value) : "")}
                  style={{ ...inp(t), width: 130 }} placeholder="0.5436%" />
              </div>
            </>
          )}

          {kind === "bimestral" && (
            <div>
              <label style={lbl(t)}>Bimestre</label>
              <select value={bimester} onChange={e => setBimester(Number(e.target.value))} style={inp(t)}>
                {BIMESTRES.map(b => <option key={b.n} value={b.n}>{b.label}</option>)}
              </select>
            </div>
          )}

          <button onClick={load} style={btnGhost(t)}><RefreshCw size={14} /></button>

          {data && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={() => kind === "mensual"
                        ? hrApi.downloadCedulaImssXlsx(year, month, primaRt ? Number(primaRt) : undefined)
                        : hrApi.downloadCedulaBimestralXlsx(year, bimester)}
                style={btnGhost(t)}>
                <Download size={14} /> XLSX
              </button>
              <button onClick={() => kind === "mensual"
                        ? hrApi.downloadCedulaImssPdf(year, month, primaRt ? Number(primaRt) : undefined)
                        : hrApi.downloadCedulaBimestralPdf(year, bimester)}
                style={btnPrimary(t)}>
                <FileText size={14} /> Cédula PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad,
                      borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ ...glass, padding: 30, textAlign: "center", color: t.textLo }}>
          Cargando cédula...
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            <Kpi t={t} icon={Users} label="Empleados"
                 value={String(data.totals?.total_employees || 0)}
                 sub={`${data.totals?.total_days || 0} días cotizados`}
                 color={t.nova} />
            <Kpi t={t} icon={Building2} label="Cuota patronal"
                 value={mxn0(data.totals?.total_patron)}
                 sub={kind === "mensual" ? "IMSS" : "SAR + INFONAVIT 5%"}
                 color={t.textMid} />
            <Kpi t={t} icon={DollarSign} label="Cuota obrera"
                 value={mxn0(data.totals?.total_obrero)}
                 sub="Retenida al trabajador" color={t.textMid} />
            <Kpi t={t} icon={Calendar} label="Total a pagar"
                 value={mxn(totalPagar)}
                 sub={`Fecha límite: ${data.payment_deadline}`}
                 color={t.good} />
          </div>

          {/* Desglose por ramo */}
          {data.totals?.por_ramo && (
            <div style={{ ...glass, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.textMid, marginBottom: 10,
                            textTransform: "uppercase", letterSpacing: 0.5 }}>
                Desglose por ramo
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {ramosOrd.map(k => {
                  const v = data.totals.por_ramo[k];
                  if (!v) return null;
                  return (
                    <div key={k} style={{ padding: 12, background: t.panel2, borderRadius: 10,
                                          border: `1px solid ${t.border}` }}>
                      <div style={{ fontSize: 11.5, color: t.textLo, fontWeight: 600 }}>
                        {data.ramos_labels?.[k] || k}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                        <div>
                          <div style={{ fontSize: 10, color: t.textLo }}>Patrón</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{mxn0(v.patron)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 10, color: t.textLo }}>Obrero</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: t.textMid }}>{mxn0(v.obrero)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabla por empleado */}
          <div style={{ ...glass, overflow: "auto", maxHeight: "55vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, fontSize: 12 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={th(t, 220, true)}>Empleado</th>
                  <th style={th(t, 120)}>NSS</th>
                  <th style={{ ...th(t, 70), textAlign: "right" }}>Días</th>
                  <th style={{ ...th(t, 100), textAlign: "right" }}>SBC topado</th>
                  <th style={{ ...th(t, 100), textAlign: "right" }}>Cuota patrón</th>
                  <th style={{ ...th(t, 100), textAlign: "right" }}>Cuota obrero</th>
                  {kind === "bimestral" && (
                    <th style={{ ...th(t, 130), textAlign: "right" }}>Amortiz. INFONAVIT</th>
                  )}
                  <th style={{ ...th(t, 110), textAlign: "right", background: t.nova + "22" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows || []).length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 30, color: t.textLo }}>
                    Sin nómina calculada en el periodo.
                  </td></tr>
                )}
                {(data.rows || []).map((r: any, i: number) => {
                  const bg = i % 2 === 0 ? t.panel : t.panel2 + "80";
                  const total = r.total_pagar_imss || (r.total_patron + r.total_obrero + (r.infonavit_descuento || 0));
                  return (
                    <tr key={r.employee_id} style={{ borderTop: `1px solid ${t.border}`, background: bg }}>
                      <td style={{ ...td(t), position: "sticky", left: 0, background: "inherit" }}>
                        <div style={{ fontWeight: 600, color: t.textHi }}>{r.employee_name}</div>
                        <div style={{ fontSize: 10.5, color: t.textLo }}>
                          #{r.employee_number} · CURP {r.curp || "—"}
                        </div>
                      </td>
                      <td style={td(t)}>{r.nss || "—"}</td>
                      <td style={{ ...td(t), textAlign: "right" }}>{r.days_cotizados.toFixed(0)}</td>
                      <td style={{ ...td(t), textAlign: "right" }}>{mxn(r.sbc_topado)}</td>
                      <td style={{ ...td(t), textAlign: "right", fontWeight: 600 }}>{mxn(r.total_patron)}</td>
                      <td style={{ ...td(t), textAlign: "right", color: t.textMid }}>{mxn(r.total_obrero)}</td>
                      {kind === "bimestral" && (
                        <td style={{ ...td(t), textAlign: "right", color: t.warn }}>
                          {mxn(r.infonavit_descuento || 0)}
                        </td>
                      )}
                      <td style={{ ...td(t), textAlign: "right", fontWeight: 700, color: t.nova }}>
                        {mxn(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {(data.rows || []).length > 0 && (
                <tfoot>
                  <tr style={{ background: t.nova + "18", borderTop: `2px solid ${t.nova}` }}>
                    <td style={{ ...td(t), fontWeight: 800, position: "sticky", left: 0,
                                  background: t.nova + "18" }} colSpan={2}>TOTALES</td>
                    <td style={{ ...td(t), textAlign: "right", fontWeight: 800 }}>{(data.totals?.total_days || 0).toFixed(0)}</td>
                    <td style={td(t)}></td>
                    <td style={{ ...td(t), textAlign: "right", fontWeight: 800 }}>{mxn(data.totals?.total_patron)}</td>
                    <td style={{ ...td(t), textAlign: "right", fontWeight: 800 }}>{mxn(data.totals?.total_obrero)}</td>
                    {kind === "bimestral" && (
                      <td style={{ ...td(t), textAlign: "right", fontWeight: 800, color: t.warn }}>
                        {mxn(data.totals?.total_infonavit_descuento)}
                      </td>
                    )}
                    <td style={{ ...td(t), textAlign: "right", fontWeight: 800, color: t.nova, fontSize: 14 }}>
                      {mxn(totalPagar)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div style={{ ...glass, padding: 12, fontSize: 11.5, color: t.textLo }}>
            <b>Nota fiscal:</b> Esta cédula es de apoyo. El pago oficial se realiza desde el <b>SUA</b> del IMSS con las líneas de captura que emite al valorar la propuesta. Los importes pueden diferir en centavos por redondeos entre nuestro cálculo y el del SUA.
            {kind === "mensual" && data.prima_rt && (
              <div style={{ marginTop: 4 }}>
                Prima RT usada: <b>{(data.prima_rt * 100).toFixed(5)}%</b>
                {" · "}El patrón determina su prima real conforme al Anexo 5.9 IMSS.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function Kpi({ t, icon: Icon, label, value, sub, color }: any) {
  return (
    <div style={{
      background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: 14, display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10, background: color + "22", color,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.textHi, marginTop: 2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

const th = (t: any, w: number, sticky = false): React.CSSProperties => ({
  padding: "10px 10px", textAlign: "left", color: t.textMid, fontSize: 11,
  fontWeight: 700, minWidth: w, whiteSpace: "nowrap",
  position: sticky ? "sticky" : undefined,
  left: sticky ? 0 : undefined, background: sticky ? t.panel2 : undefined,
  zIndex: sticky ? 2 : undefined,
  borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3,
});
const td = (t: any): React.CSSProperties => ({
  padding: "8px 10px", color: t.textHi, fontSize: 12, verticalAlign: "middle",
});
const inp = (t: any): React.CSSProperties => ({
  padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none",
});
const lbl = (t: any): React.CSSProperties => ({
  display: "block", fontSize: 11.5, color: t.textMid, marginBottom: 4, fontWeight: 600,
});
const btnGhost = (t: any): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13,
});
const btnPrimary = (t: any): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8, border: "none",
  background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
  color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
});
