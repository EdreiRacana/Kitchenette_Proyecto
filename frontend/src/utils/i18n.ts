// i18n util compartido: convierte strings ES → EN.
// Usado desde el Tablero, Inventario y Finanzas para traducir textos que
// llegan del backend (labels de KPIs, tabs, status, categorias, alertas)
// sin tener que meter un diccionario en cada modulo.

export type Lang = "es" | "en";

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Diccionario ES → EN. Keys ES en su forma "natural" (con acentos y casing).
// La lookup se hace normalizada (case-insensitive, sin acentos, colapsando
// espacios) para tolerar variaciones del backend.
const ES_EN_RAW: Record<string, string> = {
  // ─────── Tablero — KPIs hero ───────
  "Ingresos Totales": "Total Revenue",
  "Ingresos": "Revenue",
  "Utilidad Neta": "Net Profit",
  "Utilidad neta": "Net Profit",
  "Pedidos": "Orders",
  "Ticket Promedio": "Avg. Ticket",
  "Margen de Ganancia": "Profit Margin",
  "Margen": "Margin",
  "Cuentas por Cobrar": "Accounts Receivable",
  "vs. periodo anterior": "vs. previous period",
  "vs periodo anterior": "vs previous period",
  "Utilidad / Ingresos": "Profit / Revenue",
  "de la meta": "of target",

  // ─────── Tablero — KPIs operativos ───────
  "Cumplimiento de meta": "Goal Achievement",
  "Margen neto vs objetivo": "Net Margin vs Target",
  "Cobranza del período": "Collections in Period",
  "Salud del inventario": "Inventory Health",
  "Real vs forecast del mes": "Actual vs monthly forecast",
  "Objetivo 25% margen": "Target 25% margin",
  "Pagado / Vendido": "Paid / Sold",
  "% SKUs sobre punto de reorden": "% SKUs above reorder point",

  // ─────── Tablero — KPIs financieros ───────
  "Liquidez Corriente": "Current Ratio",
  "Endeudamiento": "Leverage",
  "Rotación de Inventario": "Inventory Turnover",
  "Días de Cobranza": "DSO (Days Sales Outstanding)",
  "Días de Pago": "DPO (Days Payable Outstanding)",
  "COGS / Inventario prom.": "COGS / Avg. inventory",
  "Sin COGS o inventario capturado": "No COGS or inventory captured",
  "AR / Ventas × días": "AR / Sales × days",
  "Captura balance en Contabilidad": "Enter balance sheet in Accounting",
  "Sin datos": "No data",
  "Sin ventas en el periodo": "No sales in the period",

  // ─────── Tablero — Alertas ───────
  "CARTERA": "AR",
  "RETAIL": "RETAIL",
  "STOCK": "STOCK",
  "INVENTARIO": "INVENTORY",
  "FINANZAS": "FINANCE",
  "Alerta retail": "Retail alert",

  // ─────── Inventory — Tabs ───────
  "Dashboard": "Dashboard",
  "Productos": "Products",
  "Almacenes": "Warehouses",
  "Proveedores": "Suppliers",
  "Entradas": "Receipts",
  "Movimientos": "Movements",
  "Ajustes": "Adjustments",
  "Compras": "Purchases",
  "Recetas": "Recipes",
  "Producción": "Production",
  "Kardex": "Kardex",
  "Devoluciones": "Returns",
  "Traslados": "Transfers",
  "Alertas": "Alerts",
  "Promociones": "Promotions",
  "Marketplaces": "Marketplaces",

  // ─────── Inventory — Warehouse types ───────
  "Propio": "Own",
  "Marketplace": "Marketplace",
  "Consignación": "Consignment",
  "Tránsito": "Transit",

  // ─────── Inventory — Movement types ───────
  "Entrada": "Inbound",
  "Salida": "Outbound",
  "Ajuste": "Adjustment",

  // ─────── Inventory — Purchase order status ───────
  "Borrador": "Draft",
  "Enviada": "Sent",
  "Recibida": "Received",
  "Cancelada": "Cancelled",
  "Completada": "Completed",
  "Aprobada": "Approved",
  "Rechazada": "Rejected",

  // ─────── Inventory — Comunes ───────
  "SKU": "SKU",
  "Stock": "Stock",
  "Costo": "Cost",
  "Precio": "Price",
  "Categoría": "Category",
  "Descripción": "Description",
  "Nombre": "Name",
  "Cantidad": "Quantity",
  "Total": "Total",
  "Subtotal": "Subtotal",
  "Impuesto": "Tax",
  "IVA": "VAT",
  "Descuento": "Discount",
  "Fecha": "Date",
  "Referencia": "Reference",
  "Acciones": "Actions",
  "Nuevo": "New",
  "Editar": "Edit",
  "Eliminar": "Delete",
  "Guardar": "Save",
  "Cancelar": "Cancel",
  "Buscar": "Search",
  "Exportar": "Export",
  "Importar": "Import",
  "Filtrar": "Filter",
  "Todos": "All",
  "Activo": "Active",
  "Inactivo": "Inactive",
  "Agotado": "Out of stock",
  "Stock bajo": "Low stock",
  "Bajo stock": "Low stock",
  "Sin stock": "Out of stock",
  "En stock": "In stock",
  "Valor de inventario": "Inventory value",
  "Costo de inventario": "Inventory cost",
  "Productos activos": "Active products",
  "Total productos": "Total products",
  "Alertas activas": "Active alerts",
  "Punto de reorden": "Reorder point",
  "Stock de seguridad": "Safety stock",
  "Ver detalle": "View details",
  "Nuevo producto": "New product",
  "Nueva entrada": "New receipt",
  "Nueva salida": "New outbound",
  "Nuevo ajuste": "New adjustment",
  "Nueva orden": "New order",
  "Nueva compra": "New purchase",
  "Ordenar": "Order",
  "Recibir": "Receive",
  "Enviar": "Send",
  "Aprobar": "Approve",
  "Rechazar": "Reject",
  "Duplicar": "Duplicate",
  "Imprimir": "Print",
  "Descargar": "Download",
  "Subir": "Upload",
  "Sin resultados": "No results",
  "Cargando…": "Loading…",
  "Cargando...": "Loading...",
  "Error": "Error",
  "Éxito": "Success",
  "Advertencia": "Warning",

  // ─────── Finance — Tabs ───────
  "CXC": "AR",
  "CxC": "AR",
  "CXP": "AP",
  "CxP": "AP",
  "Bancos": "Banks",
  "Transacciones": "Transactions",
  "Flujo de caja": "Cash Flow",
  "Conciliación": "Reconciliation",
  "Presupuestos": "Budgets",
  "Cuentas por cobrar": "Accounts Receivable",
  "Cuentas por pagar": "Accounts Payable",

  // ─────── Finance — Status ───────
  "Pendiente": "Pending",
  "Parcial": "Partial",
  "Vencido": "Overdue",
  "Pagado": "Paid",
  "Cobrado": "Collected",
  "Al día": "Current",
  "En proceso": "In process",
  "Conciliado": "Reconciled",
  "No conciliado": "Unreconciled",

  // ─────── Finance — Categorias ───────
  "Ventas": "Sales",
  "Nómina": "Payroll",
  "Servicios": "Services",
  "Otros": "Other",
  "Renta": "Rent",
  "Impuestos": "Taxes",
  "Comisiones": "Commissions",
  "Marketing": "Marketing",
  "Transporte": "Transportation",
  "Mantenimiento": "Maintenance",
  "Insumos": "Supplies",
  "Compra": "Purchase",
  "Otro": "Other",

  // ─────── Finance — Bank types ───────
  "Cheques": "Checking",
  "Ahorro": "Savings",
  "Crédito": "Credit",

  // ─────── Finance — Comunes ───────
  "Ingreso": "Income",
  "Egreso": "Expense",
  "Gasto": "Expense",
  "Ingresos": "Income",
  "Gastos": "Expenses",
  "Utilidad": "Profit",
  "Pérdida": "Loss",
  "Saldo": "Balance",
  "Monto": "Amount",
  "Concepto": "Concept",
  "Cuenta": "Account",
  "Cliente": "Customer",
  "Proveedor": "Supplier",
  "Factura": "Invoice",
  "Recibo": "Receipt",
  "Método de pago": "Payment method",
  "Fecha de vencimiento": "Due date",
  "Días vencido": "Days overdue",
  "Aging": "Aging",
  "Antigüedad": "Aging",
  "Cobrar": "Collect",
  "Pagar": "Pay",
  "Registrar pago": "Record payment",
  "Registrar cobro": "Record collection",
  "Transferencia": "Transfer",
  "Depósito": "Deposit",
  "Retiro": "Withdrawal",
  "Movimiento": "Movement",
  "Saldos por edad": "Balances by aging",
  "Este mes": "This month",
  "Este año": "This year",
  "Últimos 30 días": "Last 30 days",
  "Últimos 7 días": "Last 7 days",
  "Últimos 90 días": "Last 90 days",
};

const ES_EN: Record<string, string> = Object.fromEntries(
  Object.entries(ES_EN_RAW).map(([k, v]) => [normKey(k), v])
);

// Traduce un string ES a EN. Si no hay match exacto, aplica patrones dinamicos
// (numeros, dias, unidades). Si nada matchea, devuelve el original — asi
// nunca rompe cuando aparece texto nuevo.
export function tr(s: string | null | undefined, lang: Lang): string {
  if (s == null) return "";
  if (lang === "es") return s;

  const nk = normKey(s);
  if (ES_EN[nk]) return ES_EN[nk];

  let out = s;

  // Frases con prefijos comunes
  out = out.replace(/^saldo\s+pendiente\s+/i, "Outstanding balance ");
  out = out.replace(/^sobreinventario\s+en\s+/i, "Overstock in ");
  out = out.replace(/^punto\s+de\s+reorden\s+alcanzado/i, "Reorder point reached");
  out = out.replace(/^disponible\s+(\d+)\s*\/\s*reorden\s+(\d+)$/i, "Available $1 / reorder $2");
  out = out.replace(/^balance\s+/i, "Balance sheet ");
  out = out.replace(/\bsin\s+pasivo\s+corto\s+plazo/gi, "no short-term liabilities");
  out = out.replace(/\bsin\s+activo/gi, "no assets");
  out = out.replace(/^(\d+)\s+ó?rdenes?\s+con\s+saldo$/i, (_m, n) => `${n} order${n === "1" ? "" : "s"} with balance`);
  out = out.replace(/^(\d+)\s+pedidos?$/i, (_m, n) => `${n} order${n === "1" ? "" : "s"}`);
  out = out.replace(/^(\d+)\s+facturas?$/i, (_m, n) => `${n} invoice${n === "1" ? "" : "s"}`);
  out = out.replace(/^(\d+)\s+productos?$/i, (_m, n) => `${n} product${n === "1" ? "" : "s"}`);
  out = out.replace(/^(\d+)\s+almacen(es)?$/i, (_m, n) => `${n} warehouse${n === "1" ? "" : "s"}`);
  out = out.replace(/^(\d+)\s+proveedor(es)?$/i, (_m, n) => `${n} supplier${n === "1" ? "" : "s"}`);
  out = out.replace(/^(\d+)\s+clientes?$/i, (_m, n) => `${n} customer${n === "1" ? "" : "s"}`);
  out = out.replace(/^(\d+)\s+movimientos?$/i, (_m, n) => `${n} movement${n === "1" ? "" : "s"}`);
  out = out.replace(/(\d+)\s+d[ií]as?\s+atr[aá]s/gi, "$1 days ago");
  out = out.replace(/(\d+)\s+d[ií]as?/gi, "$1 days");
  out = out.replace(/(\d+)\s+sem\.?/gi, "$1 wk");
  out = out.replace(/(\d+)u\b/gi, "$1u");
  out = out.replace(/(\d+)\s+ped\.?/gi, "$1 ord.");
  out = out.replace(/^m[aá]x\s+/i, "max ");
  out = out.replace(/^rp:\s*/i, "reorder: ");

  return out;
}

// Detecta el idioma actual a partir del bundle `s` del App (por si el modulo
// no recibe el prop `lang` directamente).
export function detectLang(s: any): Lang {
  return (s?.nav?.dashboard || "").toLowerCase().includes("dash") ? "en" : "es";
}
