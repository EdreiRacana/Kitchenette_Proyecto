// Professional customer form — sectioned modal.
// Reuses the Sales module's themed UI primitives and theme adapter.

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Plus, Trash2, Building2, FileText, CreditCard, Users, Phone, MapPin } from "lucide-react";
import type { Tokens, Translator } from "../sales/theme";
import { Modal, Field, TextInput, NumberInput, Select, Button } from "../sales/ui";
import type { Customer, CustomerDraft } from "./types";
import {
  regimenesForRfc, USOS_CFDI, SUCURSALES, PRICE_LISTS,
  CLIENT_TYPES, AGENTES, CUENTAS_CONTABLES, HOW_HEARD, ESTADOS, MUNICIPIOS, PAISES,
} from "./catalogs";

const GRID: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14,
};

// IMPORTANT: defined at module scope (NOT inside CustomerForm). If it were nested,
// every keystroke would remount the inputs and you couldn't type.
function Section({ tk, icon, title, children }: {
  tk: Tokens; icon: ReactNode; title: string; children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: tk.accent, display: "flex" }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: tk.border }} />
      </div>
      <div style={GRID}>{children}</div>
    </div>
  );
}

function emptyDraft(): CustomerDraft {
  return {
    razon_social: "", nombre_comercial: "", name: "", client_type: "",
    rfc: "", regimen_fiscal: "", uso_cfdi: "G03", cuenta_contable: "105-01-001",
    sucursal: "", price_list: "", credit_days: 0, credit_amount: 0, discount_pact: 0,
    account_number: "", sales_agent: "", credit_agent: "", how_heard: "",
    email: "", phone: "", phones: [],
    pais: "México", estado: "", municipio: "", localidad: "", calle: "", colonia: "",
    codigo_postal: "", no_exterior: "", no_interior: "", codigo_colonia: "",
    codigo_localidad: "", referencia: "", address: "",
    is_active: true, notes: "",
  };
}

function fromCustomer(c: Customer): CustomerDraft {
  return { ...emptyDraft(), ...c, phones: c.phones ?? [] };
}

const toOpts = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));

export function CustomerForm({ tk, tr, open, onClose, onSubmit, editing, saving }: {
  tk: Tokens; tr: Translator; open: boolean; onClose: () => void;
  onSubmit: (d: CustomerDraft) => void; editing: Customer | null; saving: boolean;
}) {
  const [d, setD] = useState<CustomerDraft>(emptyDraft());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setD(editing ? fromCustomer(editing) : emptyDraft()); setErr(null); }
  }, [open, editing]);

  const set = <K extends keyof CustomerDraft>(k: K, v: CustomerDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const regimenOpts = useMemo(() => regimenesForRfc(d.rfc || ""), [d.rfc]);
  const municipioList = d.estado ? MUNICIPIOS[d.estado] : undefined;

  const submit = () => {
    if (!d.razon_social && !d.nombre_comercial && !d.name) {
      setErr(tr("cust_need_name", "Captura al menos la Razón Social o el Nombre Comercial."));
      return;
    }
    if (d.rfc && ![12, 13].includes(d.rfc.trim().length)) {
      setErr(tr("cust_bad_rfc", "El RFC debe tener 12 (moral) o 13 (física) caracteres."));
      return;
    }
    setErr(null);
    onSubmit(d);
  };

  return (
    <Modal tk={tk} open={open} onClose={onClose} width={860}
      title={editing ? tr("cust_edit", "Editar cliente") : tr("cust_new", "Nuevo cliente")}
      footer={
        <>
          <Button tk={tk} variant="ghost" onClick={onClose}>{tr("cancel", "Cancelar")}</Button>
          <Button tk={tk} variant="primary" onClick={submit} disabled={saving}>
            {saving ? tr("saving", "Guardando…") : tr("save", "Guardar cliente")}
          </Button>
        </>
      }>

      {/* Client number + type banner */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 200, background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: tk.textLo, marginBottom: 2 }}>{tr("cust_number", "No. de cliente")}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: editing ? tk.accent : tk.textLo }}>
            {editing?.client_number ?? tr("cust_auto", "Se asignará automáticamente")}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field tk={tk} label={tr("cust_type", "Tipo de cliente")} hint={tr("cust_type_hint", "Se sugiere automáticamente; puedes ajustarlo")}>
            <Select tk={tk} value={d.client_type || ""} onChange={(v) => set("client_type", v)}
              options={toOpts(CLIENT_TYPES)} placeholder={tr("cust_type_auto", "Automático")} />
          </Field>
        </div>
      </div>

      <Section tk={tk} icon={<Building2 size={16} />} title={tr("cust_sec_identity", "Identificación")}>
        <Field tk={tk} label={tr("cust_razon", "Razón Social")}>
          <TextInput tk={tk} value={d.razon_social || ""} onChange={(v) => set("razon_social", v)} placeholder="Comercializadora …  S.A. de C.V." />
        </Field>
        <Field tk={tk} label={tr("cust_comercial", "Nombre Comercial")}>
          <TextInput tk={tk} value={d.nombre_comercial || ""} onChange={(v) => set("nombre_comercial", v)} placeholder="John Leopard …" />
        </Field>
        <Field tk={tk} label={tr("cust_sucursal", "Sucursal")}>
          <Select tk={tk} value={d.sucursal || ""} onChange={(v) => set("sucursal", v)} options={toOpts(SUCURSALES)} placeholder={tr("select", "Selecciona…")} />
        </Field>
      </Section>

      <Section tk={tk} icon={<FileText size={16} />} title={tr("cust_sec_fiscal", "Datos fiscales · CFDI 4.0")}>
        <Field tk={tk} label="RFC" hint={tr("cust_rfc_hint", "12 = moral · 13 = física")}>
          <TextInput tk={tk} value={d.rfc || ""} onChange={(v) => set("rfc", v.toUpperCase())} placeholder="XAXX010101000" />
        </Field>
        <Field tk={tk} label={tr("cust_regimen", "Régimen Fiscal")}>
          <Select tk={tk} value={d.regimen_fiscal || ""} onChange={(v) => set("regimen_fiscal", v)} options={regimenOpts} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_uso", "Uso de CFDI")}>
          <Select tk={tk} value={d.uso_cfdi || ""} onChange={(v) => set("uso_cfdi", v)} options={USOS_CFDI} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_cuenta", "Cuenta Contable")}>
          <Select tk={tk} value={d.cuenta_contable || ""} onChange={(v) => set("cuenta_contable", v)} options={CUENTAS_CONTABLES} placeholder={tr("select", "Selecciona…")} />
        </Field>
      </Section>

      <Section tk={tk} icon={<CreditCard size={16} />} title={tr("cust_sec_commercial", "Términos comerciales")}>
        <Field tk={tk} label={tr("cust_pricelist", "Lista de Precios")}>
          <Select tk={tk} value={d.price_list || ""} onChange={(v) => set("price_list", v)} options={toOpts(PRICE_LISTS)} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_credit_days", "Días de Crédito")}>
          <NumberInput tk={tk} value={d.credit_days ?? 0} onChange={(v) => set("credit_days", Math.round(v))} min={0} step={1} />
        </Field>
        <Field tk={tk} label={tr("cust_credit_amount", "Monto de Crédito")}>
          <NumberInput tk={tk} value={d.credit_amount ?? 0} onChange={(v) => set("credit_amount", v)} min={0} step={100} />
        </Field>
        <Field tk={tk} label={tr("cust_discount", "Descuento Pactado (%)")}>
          <NumberInput tk={tk} value={d.discount_pact ?? 0} onChange={(v) => set("discount_pact", v)} min={0} step={0.5} />
        </Field>
        <Field tk={tk} label={tr("cust_account", "No. de Cuenta (banco)")}>
          <TextInput tk={tk} value={d.account_number || ""} onChange={(v) => set("account_number", v)} placeholder="CLABE / cuenta" />
        </Field>
      </Section>

      <Section tk={tk} icon={<Users size={16} />} title={tr("cust_sec_assign", "Asignaciones")}>
        <Field tk={tk} label={tr("cust_sales_agent", "Ventas")}>
          <Select tk={tk} value={d.sales_agent || ""} onChange={(v) => set("sales_agent", v)} options={toOpts(AGENTES)} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_credit_agent", "Créditos")}>
          <Select tk={tk} value={d.credit_agent || ""} onChange={(v) => set("credit_agent", v)} options={toOpts(AGENTES)} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_how_heard", "¿Cómo se enteró de nosotros?")}>
          <Select tk={tk} value={d.how_heard || ""} onChange={(v) => set("how_heard", v)} options={toOpts(HOW_HEARD)} placeholder={tr("select", "Selecciona…")} />
        </Field>
      </Section>

      <Section tk={tk} icon={<Phone size={16} />} title={tr("cust_sec_contact", "Contacto")}>
        <Field tk={tk} label={tr("cust_email", "Correo Electrónico")}>
          <TextInput tk={tk} type="email" value={d.email || ""} onChange={(v) => set("email", v)} placeholder="cliente@correo.com" />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field tk={tk} label={tr("cust_phones", "Teléfono(s)")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <TextInput tk={tk} value={d.phone || ""} onChange={(v) => set("phone", v)} placeholder={tr("cust_phone_main", "Principal")} />
              {(d.phones || []).map((ph, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <TextInput tk={tk} value={ph} onChange={(v) => {
                      const arr = [...(d.phones || [])]; arr[i] = v; set("phones", arr);
                    }} placeholder={tr("cust_phone_extra", "Adicional")} />
                  </div>
                  <button onClick={() => set("phones", (d.phones || []).filter((_, j) => j !== i))}
                    title={tr("remove", "Quitar")} style={{ background: "transparent", border: `1px solid ${tk.border}`, borderRadius: 8, padding: 8, cursor: "pointer", color: tk.bad, display: "flex" }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button onClick={() => set("phones", [...(d.phones || []), ""])}
                style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1px dashed ${tk.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: tk.accent, fontSize: 13, fontWeight: 600 }}>
                <Plus size={14} /> {tr("cust_add_phone", "Agregar teléfono")}
              </button>
            </div>
          </Field>
        </div>
      </Section>

      <Section tk={tk} icon={<MapPin size={16} />} title={tr("cust_sec_address", "Domicilio fiscal")}>
        <Field tk={tk} label={tr("cust_pais", "País")}>
          <Select tk={tk} value={d.pais || ""} onChange={(v) => set("pais", v)} options={toOpts(PAISES)} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_estado", "Estado")}>
          <Select tk={tk} value={d.estado || ""} onChange={(v) => { set("estado", v); set("municipio", ""); }} options={toOpts(ESTADOS)} placeholder={tr("select", "Selecciona…")} />
        </Field>
        <Field tk={tk} label={tr("cust_municipio", "Municipio")}>
          {municipioList
            ? <Select tk={tk} value={d.municipio || ""} onChange={(v) => set("municipio", v)} options={toOpts(municipioList)} placeholder={tr("select", "Selecciona…")} />
            : <TextInput tk={tk} value={d.municipio || ""} onChange={(v) => set("municipio", v)} placeholder={tr("cust_municipio_free", "Captura el municipio")} />}
        </Field>
        <Field tk={tk} label={tr("cust_localidad", "Localidad")}>
          <TextInput tk={tk} value={d.localidad || ""} onChange={(v) => set("localidad", v)} />
        </Field>
        <Field tk={tk} label={tr("cust_colonia", "Colonia")}>
          <TextInput tk={tk} value={d.colonia || ""} onChange={(v) => set("colonia", v)} />
        </Field>
        <Field tk={tk} label={tr("cust_cp", "Código Postal")}>
          <TextInput tk={tk} value={d.codigo_postal || ""} onChange={(v) => set("codigo_postal", v)} placeholder="00000" />
        </Field>
        <Field tk={tk} label={tr("cust_calle", "Calle")}>
          <TextInput tk={tk} value={d.calle || ""} onChange={(v) => set("calle", v)} />
        </Field>
        <Field tk={tk} label={tr("cust_no_ext", "No. exterior")}>
          <TextInput tk={tk} value={d.no_exterior || ""} onChange={(v) => set("no_exterior", v)} />
        </Field>
        <Field tk={tk} label={tr("cust_no_int", "No. interior")}>
          <TextInput tk={tk} value={d.no_interior || ""} onChange={(v) => set("no_interior", v)} />
        </Field>
        <Field tk={tk} label={tr("cust_cod_col", "Código Colonia (opcional)")}>
          <TextInput tk={tk} value={d.codigo_colonia || ""} onChange={(v) => set("codigo_colonia", v)} />
        </Field>
        <Field tk={tk} label={tr("cust_cod_loc", "Código Localidad (opcional)")}>
          <TextInput tk={tk} value={d.codigo_localidad || ""} onChange={(v) => set("codigo_localidad", v)} />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field tk={tk} label={tr("cust_ref", "Referencia de la calle")}>
            <TextInput tk={tk} value={d.referencia || ""} onChange={(v) => set("referencia", v)} placeholder={tr("cust_ref_ph", "Entre calles, color de fachada, etc.")} />
          </Field>
        </div>
      </Section>

      {err && (
        <div style={{ background: tk.bad + "18", border: `1px solid ${tk.bad}55`, color: tk.bad, borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          {err}
        </div>
      )}
    </Modal>
  );
}
