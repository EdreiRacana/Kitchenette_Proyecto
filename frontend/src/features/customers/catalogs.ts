// Catalogs for the Customers module.
// Fiscal catalogs follow CFDI 4.0 (SAT Anexo 20): c_RegimenFiscal + c_UsoCFDI.

export interface Opt { value: string; label: string }

// ── SAT · Régimen Fiscal (c_RegimenFiscal). persona: F=física, M=moral ──────
export const REGIMENES_FISCALES: { code: string; label: string; persona: "F" | "M" | "FM" }[] = [
  { code: "601", label: "General de Ley Personas Morales", persona: "M" },
  { code: "603", label: "Personas Morales con Fines no Lucrativos", persona: "M" },
  { code: "605", label: "Sueldos y Salarios e Ingresos Asimilados a Salarios", persona: "F" },
  { code: "606", label: "Arrendamiento", persona: "F" },
  { code: "607", label: "Régimen de Enajenación o Adquisición de Bienes", persona: "F" },
  { code: "608", label: "Demás ingresos", persona: "F" },
  { code: "610", label: "Residentes en el Extranjero sin Establecimiento Permanente en México", persona: "FM" },
  { code: "611", label: "Ingresos por Dividendos (socios y accionistas)", persona: "F" },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales", persona: "F" },
  { code: "614", label: "Ingresos por intereses", persona: "F" },
  { code: "615", label: "Régimen de los ingresos por obtención de premios", persona: "F" },
  { code: "616", label: "Sin obligaciones fiscales", persona: "F" },
  { code: "620", label: "Sociedades Cooperativas de Producción que optan por diferir sus ingresos", persona: "M" },
  { code: "621", label: "Incorporación Fiscal", persona: "F" },
  { code: "622", label: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", persona: "FM" },
  { code: "623", label: "Opcional para Grupos de Sociedades", persona: "M" },
  { code: "624", label: "Coordinados", persona: "M" },
  { code: "625", label: "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", persona: "F" },
  { code: "626", label: "Régimen Simplificado de Confianza (RESICO)", persona: "FM" },
];

// ── SAT · Uso de CFDI (c_UsoCFDI) ────────────────────────────────────────────
export const USOS_CFDI: Opt[] = [
  { value: "G01", label: "G01 · Adquisición de mercancías" },
  { value: "G02", label: "G02 · Devoluciones, descuentos o bonificaciones" },
  { value: "G03", label: "G03 · Gastos en general" },
  { value: "I01", label: "I01 · Construcciones" },
  { value: "I02", label: "I02 · Mobiliario y equipo de oficina por inversiones" },
  { value: "I03", label: "I03 · Equipo de transporte" },
  { value: "I04", label: "I04 · Equipo de cómputo y accesorios" },
  { value: "I05", label: "I05 · Dados, troqueles, moldes, matrices y herramental" },
  { value: "I06", label: "I06 · Comunicaciones telefónicas" },
  { value: "I07", label: "I07 · Comunicaciones satelitales" },
  { value: "I08", label: "I08 · Otra maquinaria y equipo" },
  { value: "D01", label: "D01 · Honorarios médicos, dentales y gastos hospitalarios" },
  { value: "D02", label: "D02 · Gastos médicos por incapacidad o discapacidad" },
  { value: "D03", label: "D03 · Gastos funerales" },
  { value: "D04", label: "D04 · Donativos" },
  { value: "D05", label: "D05 · Intereses por créditos hipotecarios (casa habitación)" },
  { value: "D06", label: "D06 · Aportaciones voluntarias al SAR" },
  { value: "D07", label: "D07 · Primas por seguros de gastos médicos" },
  { value: "D08", label: "D08 · Gastos de transportación escolar obligatoria" },
  { value: "D09", label: "D09 · Depósitos en cuentas para el ahorro / pensiones" },
  { value: "D10", label: "D10 · Pagos por servicios educativos (colegiaturas)" },
  { value: "S01", label: "S01 · Sin efectos fiscales" },
  { value: "CP01", label: "CP01 · Pagos" },
  { value: "CN01", label: "CN01 · Nómina" },
  { value: "P01", label: "P01 · Por definir" },
];

// ── Commercial catalogs (genéricos, válidos para cualquier empresa) ──────────
// Placeholders hasta que se den de alta los almacenes reales en Inventario.
export const SUCURSALES: string[] = ["CEDIS 1", "CEDIS 2", "CEDIS 3"];
export const PRICE_LISTS: string[] = ["General", "Mayoreo", "Menudeo", "Distribuidor", "VIP"];
export const CLIENT_TYPES: string[] = ["Contado", "Crédito", "Mayorista", "Distribuidor", "VIP"];

// Placeholders genéricos hasta que cada empresa dé de alta a sus agentes reales.
export const AGENTES: string[] = ["Agente 1", "Agente 2", "Agente 3"];

export const CUENTAS_CONTABLES: Opt[] = [
  { value: "105-01-001", label: "105-01-001 · Clientes Nacionales" },
  { value: "105-01-002", label: "105-01-002 · Clientes Extranjeros" },
  { value: "105-02-001", label: "105-02-001 · Clientes Mostrador" },
];

export const HOW_HEARD: string[] = [
  "Recomendación", "Instagram", "Facebook", "TikTok", "Google",
  "Página web", "Punto de venta", "Marketplace", "Otro",
];

// ── Geography ─────────────────────────────────────────────────────────────────
export const ESTADOS: string[] = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas",
  "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango", "Guanajuato",
  "Guerrero", "Hidalgo", "Jalisco", "México", "Michoacán", "Morelos", "Nayarit",
  "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí",
  "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán",
  "Zacatecas",
];

// Municipios for the most common operating states (+ Aguascalientes as
// reference). For any other state the form falls back to a free-text input.
// The full INEGI catalog (~2,469 municipios) can be dropped in here later.
export const MUNICIPIOS: Record<string, string[]> = {
  "Ciudad de México": [
    "Álvaro Obregón", "Azcapotzalco", "Benito Juárez", "Coyoacán",
    "Cuajimalpa de Morelos", "Cuauhtémoc", "Gustavo A. Madero", "Iztacalco",
    "Iztapalapa", "La Magdalena Contreras", "Miguel Hidalgo", "Milpa Alta",
    "Tláhuac", "Tlalpan", "Venustiano Carranza", "Xochimilco",
  ],
  "México": [
    "Atizapán de Zaragoza", "Naucalpan de Juárez", "Tlalnepantla de Baz",
    "Ecatepec de Morelos", "Cuautitlán Izcalli", "Tlalmanalco", "Coacalco de Berriozábal",
    "Nezahualcóyotl", "Toluca", "Metepec", "Huixquilucan", "Nicolás Romero",
    "Tultitlán", "Chimalhuacán", "Texcoco", "Chalco", "Ixtapaluca", "La Paz",
    "Valle de Chalco Solidaridad", "Tecámac", "Zumpango", "Cuautitlán",
    "Lerma", "Ocoyoacac", "Atenco", "Tepotzotlán", "Jilotzingo",
  ],
  "Aguascalientes": [
    "Aguascalientes", "Asientos", "Calvillo", "Cosío", "El Llano", "Jesús María",
    "Pabellón de Arteaga", "Rincón de Romos", "San Francisco de los Romo",
    "San José de Gracia", "Tepezalá",
  ],
};

export const PAISES: string[] = [
  "México", "Estados Unidos", "Canadá", "Argentina", "Brasil", "Chile", "Colombia",
  "Costa Rica", "Cuba", "Ecuador", "El Salvador", "España", "Guatemala", "Honduras",
  "Nicaragua", "Panamá", "Paraguay", "Perú", "Puerto Rico", "República Dominicana",
  "Uruguay", "Venezuela", "Alemania", "Francia", "Italia", "Reino Unido", "Portugal",
  "Países Bajos", "China", "Japón", "Corea del Sur", "India", "Australia", "Otro",
];

// Régimen options filtered by RFC length (12=moral, 13=física).
export function regimenesForRfc(rfc?: string): Opt[] {
  const len = (rfc || "").trim().length;
  const persona: "F" | "M" | null = len === 13 ? "F" : len === 12 ? "M" : null;
  const list = persona
    ? REGIMENES_FISCALES.filter((r) => r.persona === persona || r.persona === "FM")
    : REGIMENES_FISCALES;
  return list.map((r) => ({ value: r.code, label: `${r.code} · ${r.label}` }));
}
