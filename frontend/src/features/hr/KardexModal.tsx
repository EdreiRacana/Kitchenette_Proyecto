// Kardex del empleado — modal profesional con historial anual completo.
// Fetch al /hr/employees/{id}/kardex y renderiza secciones. Botón descarga PDF.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Download, RefreshCw, User, Briefcase, DollarSign, Calendar,
  FileText, Heart, AlertTriangle,
} from "lucide-react";
import { hrApi } from "./api";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function KardexModal({
  t, employeeId, employeeNumber, onClose,
}: {
  t: any; employeeId: number; employeeNumber: string; onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await hrApi.getKardex(employeeId, year);
      setData(r);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar kardex");
    } finally { setLoading(false); }
  }, [employeeId, year]);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 1; y >= 2015; y--) arr.push(y);
    return arr;
  }, [now]);

  const downloadPdf = async () => {
    setDownloading(true);
    try { await hrApi.downloadKardexPdf(employeeId, employeeNumber, year); }
    catch { alert("Error al descargar PDF"); }
    finally { setDownloading(false); }
  };

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: t.panel, borderRadius: 14, maxWidth: 1100,
          width: "100%", maxHeight: "92vh", display: "flex",
          flexDirection: "column", overflow: "hidden",
          border: `1px solid ${t.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}>

        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", gap: 12, background: t.panel2,
        }}>
          <User size={20} color={t.nova} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>
              Kardex del empleado
            </div>
            {data?.employee && (
              <div style={{ fontSize: 12, color: t.textLo }}>
                {data.employee.employee_number} · {data.employee.full_name}
              </div>
            )}
          </div>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            style={{
              padding: "6px 10px", borderRadius: 6, border: `1px solid ${t.border}`,
              background: t.panel, color: t.textHi, fontSize: 12.5, outline: "none",
            }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} title="Actualizar" style={iconBtn(t)}>
            <RefreshCw size={14} />
          </button>
          <button onClick={downloadPdf} disabled={downloading || !data}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
              borderRadius: 8, border: "none",
              background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
              color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
              opacity: !data ? 0.5 : 1,
            }}>
            <Download size={13} /> {downloading ? "…" : "PDF"}
          </button>
          <button onClick={onClose} style={iconBtn(t)}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: 20, flex: 1 }}>
          {loading && <div style={{ textAlign: "center", padding: 60, color: t.textLo }}>Cargando…</div>}
          {error && (
            <div style={{ padding: 12, background: t.bad + "18", color: t.bad, borderRadius: 8, fontSize: 13 }}>
              <AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />{error}
            </div>
          )}

          {data && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Datos generales */}
              <Section t={t} icon={User} title="Datos generales">
                <KVGrid t={t} rows={[
                  ["No. empleado", data.employee.employee_number, "Nombre", data.employee.full_name],
                  ["CURP", data.employee.curp, "RFC", data.employee.rfc],
                  ["NSS", data.employee.nss || "—", "Fecha nacimiento", data.employee.birth_date || "—"],
                  ["Email", data.employee.email, "Teléfono", data.employee.phone || "—"],
                  ["Domicilio", data.employee.address || "—", "", ""],
                ]} />
              </Section>

              {/* Datos laborales */}
              <Section t={t} icon={Briefcase} title="Datos laborales">
                <KVGrid t={t} rows={[
                  ["Departamento", data.employee.department, "Puesto", data.employee.position],
                  ["Tipo contrato", data.employee.contract_type, "Estado", data.employee.status],
                  ["Fecha ingreso", data.employee.hire_date, "Antigüedad", data.employee.antiguedad.text],
                  ["Sueldo base", mxn(data.employee.base_salary), "SBC (diario)", mxn(data.employee.sbc)],
                  ["Periodicidad", data.employee.pay_frequency, "Régimen SAT", data.employee.tax_regime],
                  ["Banco", data.employee.bank || "—", "CLABE", data.employee.clabe || "—"],
                ]} />
              </Section>

              {/* Vacaciones */}
              <Section t={t} icon={Calendar} title="Vacaciones (LFT 2023)">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  <Stat t={t} label="Con derecho" value={String(data.vacations.days_earned)} />
                  <Stat t={t} label="Tomadas" value={String(data.vacations.days_used)} color={t.warn} />
                  <Stat t={t} label="Disponibles" value={String(data.vacations.days_available)} color={t.good} />
                </div>
              </Section>

              {/* Créditos y descuentos */}
              {(data.credits.infonavit_credit || data.credits.fonacot_credit || data.credits.alimony_type) && (
                <Section t={t} icon={Heart} title="Créditos y descuentos">
                  {data.credits.infonavit_credit && (
                    <div style={{ fontSize: 12.5, color: t.textMid, padding: "6px 0" }}>
                      <b style={{ color: t.textHi }}>INFONAVIT:</b> {data.credits.infonavit_credit} · {data.credits.infonavit_discount_type} · {data.credits.infonavit_discount_value}
                    </div>
                  )}
                  {data.credits.fonacot_credit && (
                    <div style={{ fontSize: 12.5, color: t.textMid, padding: "6px 0" }}>
                      <b style={{ color: t.textHi }}>FONACOT:</b> {data.credits.fonacot_credit} · descuento {data.credits.fonacot_discount_value}
                    </div>
                  )}
                  {data.credits.alimony_type && (
                    <div style={{ fontSize: 12.5, color: t.textMid, padding: "6px 0" }}>
                      <b style={{ color: t.textHi }}>Pensión alimenticia:</b> {data.credits.alimony_type} = {data.credits.alimony_value}
                      {data.credits.alimony_beneficiary && <> · {data.credits.alimony_beneficiary}</>}
                    </div>
                  )}
                </Section>
              )}

              {/* Historial de nómina */}
              <Section t={t} icon={DollarSign} title={`Historial de nómina ${data.year}`}>
                {data.payroll.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: t.textLo, fontSize: 12 }}>
                    Sin recibos de nómina en el ejercicio.
                  </div>
                ) : (
                  <>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3 }}>
                            <th style={th()}>Periodo</th>
                            <th style={th()}>Tipo</th>
                            <th style={{ ...th(), textAlign: "right" }}>Días</th>
                            <th style={{ ...th(), textAlign: "right" }}>Percepciones</th>
                            <th style={{ ...th(), textAlign: "right" }}>Deducciones</th>
                            <th style={{ ...th(), textAlign: "right" }}>Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.payroll.map((r: any, i: number) => (
                            <tr key={i} style={{ borderTop: `1px solid ${t.border}` }}>
                              <td style={td()}>{r.start_date?.slice(0,10)} → {r.end_date?.slice(0,10)}</td>
                              <td style={td()}>{r.kind}</td>
                              <td style={{ ...td(), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days_worked?.toFixed(0)}</td>
                              <td style={{ ...td(), textAlign: "right", color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(r.total_gross)}</td>
                              <td style={{ ...td(), textAlign: "right", color: t.bad, fontVariantNumeric: "tabular-nums" }}>{mxn(r.total_deductions)}</td>
                              <td style={{ ...td(), textAlign: "right", color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(r.total_net)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: t.panel2, borderTop: `2px solid ${t.nova}` }}>
                            <td style={{ ...td(), fontWeight: 800, color: t.textHi }} colSpan={3}>
                              TOTAL {data.payroll_totals.periods} periodos
                            </td>
                            <td style={{ ...td(), textAlign: "right", color: t.good, fontWeight: 800 }}>{mxn(data.payroll_totals.total_gross)}</td>
                            <td style={{ ...td(), textAlign: "right", color: t.bad, fontWeight: 800 }}>{mxn(data.payroll_totals.total_deductions)}</td>
                            <td style={{ ...td(), textAlign: "right", color: t.nova, fontWeight: 800 }}>{mxn(data.payroll_totals.total_net)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      <Stat t={t} label="ISR acumulado" value={mxn(data.payroll_totals.total_isr)} />
                      <Stat t={t} label="IMSS acumulado" value={mxn(data.payroll_totals.total_imss)} />
                      <Stat t={t} label="INFONAVIT acumulado" value={mxn(data.payroll_totals.total_infonavit)} />
                    </div>
                  </>
                )}
              </Section>

              {/* Ausentismo */}
              {Object.keys(data.attendance_summary || {}).length > 0 && (
                <Section t={t} icon={Calendar} title={`Ausentismo ${data.year}`}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                    {Object.entries(data.attendance_summary).map(([k, v]: any) => (
                      <Stat key={k} t={t} label={k} value={String(v)} />
                    ))}
                  </div>
                </Section>
              )}

              {/* Incapacidades */}
              {data.incapacities?.length > 0 && (
                <Section t={t} icon={AlertTriangle} title={`Incapacidades ${data.year}`}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5 }}>
                          <th style={th()}>Fecha</th>
                          <th style={th()}>Subtipo</th>
                          <th style={th()}>Folio IMSS</th>
                          <th style={th()}>Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.incapacities.map((i: any, idx: number) => (
                          <tr key={idx} style={{ borderTop: `1px solid ${t.border}` }}>
                            <td style={td()}>{i.date}</td>
                            <td style={td()}>{i.subtype || "—"}</td>
                            <td style={{ ...td(), fontFamily: "monospace", color: t.textMid }}>{i.imss_folio || "—"}</td>
                            <td style={{ ...td(), color: t.textLo, fontSize: 11 }}>{i.notes || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Contratos */}
              {data.contracts?.length > 0 && (
                <Section t={t} icon={FileText} title="Contratos">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {data.contracts.map((c: any) => (
                      <div key={c.id} style={{ padding: "8px 10px", background: t.panel2, borderRadius: 6, fontSize: 12, color: t.textMid, display: "flex", justifyContent: "space-between" }}>
                        <span>#{c.id} · {c.type || "—"}</span>
                        <span>{c.start_date || "—"} → {c.end_date || "Indefinido"}</span>
                        <span style={{ color: t.textLo }}>{c.status || ""}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}


// ── Subcomponents ──────────────────────────────────────────────────────

function Section({ t, icon: Icon, title, children }: any) {
  return (
    <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{
        padding: "10px 14px", background: t.panel3 || t.panel,
        borderBottom: `1px solid ${t.border}`,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <Icon size={14} color={t.nova} />
        <div style={{ fontSize: 12, color: t.textHi, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</div>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}


function KVGrid({ t, rows }: { t: any; rows: any[][] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "6px 12px", fontSize: 12.5 }}>
      {rows.flatMap((r, i) => [
        <div key={`k1-${i}`} style={{ color: t.textLo, fontWeight: 600, whiteSpace: "nowrap" }}>{r[0]}</div>,
        <div key={`v1-${i}`} style={{ color: t.textHi }}>{r[1] || "—"}</div>,
        <div key={`k2-${i}`} style={{ color: t.textLo, fontWeight: 600, whiteSpace: "nowrap" }}>{r[2]}</div>,
        <div key={`v2-${i}`} style={{ color: t.textHi }}>{r[3] || "—"}</div>,
      ])}
    </div>
  );
}


function Stat({ t, label, value, color }: any) {
  return (
    <div style={{ padding: 10, background: t.panel, borderRadius: 6, border: `1px solid ${t.border}` }}>
      <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || t.textHi, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}


const iconBtn = (t: any): React.CSSProperties => ({
  padding: 8, borderRadius: 6, border: `1px solid ${t.border}`,
  background: t.panel, color: t.textMid, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});
const th = (): React.CSSProperties => ({ padding: "8px 10px", textAlign: "left", whiteSpace: "nowrap" });
const td = (): React.CSSProperties => ({ padding: "7px 10px" });
