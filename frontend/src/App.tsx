// ... existing code ...

const THEMES: Record<string, any> = {
  es: {
    // ... existing keys ...
    // NEW SALES/CRM KEYS
    sales_search_placeholder: "Buscar por folio, cliente o estado...",
    sales_filter_status: "Estado",
    sales_filter_date_from: "Desde",
    sales_filter_date_to: "Hasta",
    sales_view_list: "Lista",
    sales_view_pipeline: "Pipeline",
    sales_col_folio: "Folio",
    sales_col_client: "Cliente",
    sales_col_date: "Fecha",
    sales_col_total: "Total",
    sales_col_status: "Estado",
    sales_col_seller: "Vendedor",
    sales_col_payment: "Método de Pago",
    sales_kpi_sold: "Total Vendido",
    sales_kpi_pending_orders: "Pedidos Pendientes",
    sales_kpi_pending_amount: "Monto por Cobrar",
    sales_kpi_paid_rate: "Tasa Pagados",
    sales_detail_title: "Detalle del Pedido",
    sales_detail_folio: "Folio",
    sales_detail_client: "Cliente",
    sales_detail_date: "Fecha",
    sales_detail_seller: "Vendedor",
    sales_detail_payment: "Método de Pago",
    sales_detail_notes: "Notas",
    sales_detail_products: "Productos",
    sales_detail_qty: "Cantidad",
    sales_detail_unit_price: "Precio Unit.",
    sales_detail_subtotal: "Subtotal",
    sales_detail_total: "Total",
    sales_detail_history: "Historial de Estado",
    sales_btn_mark_paid: "Marcar como Pagado",
    sales_btn_cancel: "Cancelar Pedido",
    sales_pipeline_draft: "Borrador",
    sales_pipeline_pending: "Pendiente",
    sales_pipeline_partial: "Parcial",
    sales_pipeline_paid: "Pagado",
    sales_no_results: "Sin resultados",
    sales_close: "Cerrar",
    sales_confirm_cancel: "¿Cancelar este pedido?",
    sales_confirm_paid: "¿Marcar como pagado?",
  },
  en: {
    // ... existing keys ...
    // NEW SALES/CRM KEYS
    sales_search_placeholder: "Search by folio, client or status...",
    sales_filter_status: "Status",
    sales_filter_date_from: "From",
    sales_filter_date_to: "To",
    sales_view_list: "List",
    sales_view_pipeline: "Pipeline",
    sales_col_folio: "Folio",
    sales_col_client: "Client",
    sales_col_date: "Date",
    sales_col_total: "Total",
    sales_col_status: "Status",
    sales_col_seller: "Seller",
    sales_col_payment: "Payment Method",
    sales_kpi_sold: "Total Sold",
    sales_kpi_pending_orders: "Pending Orders",
    sales_kpi_pending_amount: "Monto por Cobrar",
    sales_kpi_paid_rate: "Paid Rate",
    sales_detail_title: "Order Detail",
    sales_detail_folio: "Folio",
    sales_detail_client: "Client",
    sales_detail_date: "Date",
    sales_detail_seller: "Seller",
    sales_detail_payment: "Payment Method",
    sales_detail_notes: "Notes",
    sales_detail_products: "Products",
    sales_detail_qty: "Qty",
    sales_detail_unit_price: "Unit Price",
    sales_detail_subtotal: "Subtotal",
    sales_detail_total: "Total",
    sales_detail_history: "Status History",
    sales_btn_mark_paid: "Mark as Paid",
    sales_btn_cancel: "Cancel Order",
    sales_pipeline_draft: "Draft",
    sales_pipeline_pending: "Pending",
    sales_pipeline_partial: "Partial",
    sales_pipeline_paid: "Paid",
    sales_no_results: "No results",
    sales_close: "Close",
    sales_confirm_cancel: "Cancel this order?",
    sales_confirm_paid: "Mark as paid?",
  },
};

const ORDERS = [
  {
    id: 1,
    folio: "ORD-001",
    client: "Restaurante El Fogón",
    date: "2024-01-15",
    total: 4500,
    status: "Pagado",
    seller: "María López",
    paymentMethod: "Transferencia",
    notes: "Entrega urgente antes del mediodía.",
    items: [
      { product: "Pollo entero", qty: 10, unitPrice: 220 },
      { product: "Costilla de res", qty: 5, unitPrice: 380 },
      { product: "Chorizo artesanal", qty: 8, unitPrice: 150 },
    ],
    statusHistory: [
      { status: "Borrador", date: "2024-01-14 09:00" },
      { status: "Pendiente", date: "2024-01-14 10:30" },
      { status: "Pagado", date: "2024-01-15 08:15" },
    ],
  },
  {
    id: 2,
    folio: "ORD-002",
    client: "Taquería Los Compadres",
    date: "2024-01-16",
    total: 2300,
    status: "Pendiente",
    seller: "Carlos Ruiz",
    paymentMethod: "Efectivo",
    notes: "",
    items: [
      { product: "Carne de cerdo", qty: 8, unitPrice: 200 },
      { product: "Chorizo artesanal", qty: 6, unitPrice: 150 },
      { product: "Manteca", qty: 4, unitPrice: 87.5 },
    ],
    statusHistory: [
      { status: "Borrador", date: "2024-01-15 14:00" },
      { status: "Pendiente", date: "2024-01-16 09:00" },
    ],
  },
  {
    id: 3,
    folio: "ORD-003",
    client: "Hotel Gran Plaza",
    date: "2024-01-17",
    total: 8750,
    status: "Parcial",
    seller: "María López",
    paymentMethod: "Crédito",
    notes: "50% pagado al entregar. Resto a 30 días.",
    items: [
      { product: "Filete de res", qty: 15, unitPrice: 350 },
      { product: "Pollo entero", qty: 12, unitPrice: 220 },
      { product: "Camarón mediano", qty: 5, unitPrice: 430 },
    ],
    statusHistory: [
      { status: "Borrador", date: "2024-01-16 11:00" },
      { status: "Pendiente", date: "2024-01-16 15:00" },
      { status: "Parcial", date: "2024-01-17 10:00" },
    ],
  },
  {
    id: 4,
    folio: "ORD-004",
    client: "Catering Eventos MX",
    date: "2024-01-18",
    total: 5600,
    status: "Pagado",
    seller: "Ana Torres",
    paymentMethod: "Tarjeta",
    notes: "Cliente recurrente. Descuento 5% aplicado.",
    items: [
      { product: "Costilla de res", qty: 8, unitPrice: 380 },
      { product: "Pollo entero", qty: 10, unitPrice: 220 },
      { product: "Longaniza", qty: 6, unitPrice: 130 },
    ],
    statusHistory: [
      { status: "Borrador", date: "2024-01-17 08:00" },
      { status: "Pendiente", date: "2024-01-17 12:00" },
      { status: "Pagado", date: "2024-01-18 09:30" },
    ],
  },
  {
    id: 5,
    folio: "ORD-005",
    client: "Mariscos El Puerto",
    date: "2024-01-19",
    total: 3200,
    status: "Pendiente",
    seller: "Carlos Ruiz",
    paymentMethod: "Transferencia",
    notes: "",
    items: [
      { product: "Camarón mediano", qty: 5, unitPrice: 430 },
      { product: "Filete de res", qty: 4, unitPrice: 350 },
      { product: "Manteca", qty: 2, unitPrice: 87.5 },
    ],
    statusHistory: [
      { status: "Borrador", date: "2024-01-18 16:00" },
      { status: "Pendiente", date: "2024-01-19 08:00" },
    ],
  },
  {
    id: 6,
    folio: "ORD-006",
    client: "Buffet Familiar Juárez",
    date: "2024-01-20",
    total: 1950,
    status: "Borrador",
    seller: "Ana Torres",
    paymentMethod: "Efectivo",
    notes: "Por confirmar cantidades.",
    items: [
      { product: "Carne de cerdo", qty: 5, unitPrice: 200 },
      { product: "Chorizo artesanal", qty: 4, unitPrice: 150 },
      { product: "Longaniza", qty: 3, unitPrice: 130 },
    ],
    statusHistory: [
      { status: "Borrador", date: "2024-01-20 10:00" },
    ],
  },
];

function Sales({ t, s }: { t: any; s: any }) {
  // ── State ──────────────────────────────────────────────────────────────
  const [orders, setOrders] = React.useState(ORDERS);
  const [search, setSearch] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("Todos");
  const [filterFrom, setFilterFrom] = React.useState("");
  const [filterTo, setFilterTo] = React.useState("");
  const [selectedOrder, setSelectedOrder] = React.useState<typeof ORDERS[0] | null>(null);
  const [view, setView] = React.useState<"list" | "pipeline">("list");
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // ── Close panel on ESC ─────────────────────────────────────────────────
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedOrder(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Filtered orders ────────────────────────────────────────────────────
  const filtered = orders.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch =
      o.folio.toLowerCase().includes(q) ||
      o.client.toLowerCase().includes(q) ||
      o.status.toLowerCase().includes(q);
    const matchStatus = filterStatus === "Todos" || o.status === filterStatus;
    const matchFrom = !filterFrom || o.date >= filterFrom;
    const matchTo = !filterTo || o.date <= filterTo;
    return matchSearch && matchStatus && matchFrom && matchTo;
  });

  // ── KPIs ───────────────────────────────────────────────────────────────
  const totalSold = orders
    .filter((o) => o.status === "Pagado")
    .reduce((a, b) => a + b.total, 0);
  const pendingOrders = orders.filter(
    (o) => o.status === "Pendiente" || o.status === "Parcial"
  ).length;
  const pendingAmount = orders
    .filter((o) => o.status === "Pendiente" || o.status === "Parcial")
    .reduce((a, b) => a + b.total, 0);
  const paidRate = Math.round(
    (orders.filter((o) => o.status === "Pagado").length / orders.length) * 100
  );

  // ── Status helpers ─────────────────────────────────────────────────────
  const statusColor = (status: string) => {
    if (status === "Pagado") return { bg: t.success + "22", text: t.success, border: t.success + "44" };
    if (status === "Pendiente") return { bg: t.warning + "22", text: t.warning, border: t.warning + "44" };
    if (status === "Parcial") return { bg: t.accent + "22", text: t.accent, border: t.accent + "44" };
    if (status === "Cancelado") return { bg: t.danger + "22", text: t.danger, border: t.danger + "44" };
    return { bg: t.border, text: t.textSecondary, border: t.border };
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      Borrador: s("sales_pipeline_draft"),
      Pendiente: s("sales_pipeline_pending"),
      Parcial: s("sales_pipeline_partial"),
      Pagado: s("sales_pipeline_paid"),
    };
    return map[status] || status;
  };

  // ── Order actions ──────────────────────────────────────────────────────
  const markAsPaid = (id: number) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: "Pagado",
              statusHistory: [
                ...o.statusHistory,
                {
                  status: "Pagado",
                  date: new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 16),
                },
              ],
            }
          : o
      )
    );
    setSelectedOrder((prev) =>
      prev && prev.id === id
        ? {
            ...prev,
            status: "Pagado",
            statusHistory: [
              ...prev.statusHistory,
              {
                status: "Pagado",
                date: new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 16),
              },
            ],
          }
        : prev
    );
  };

  const cancelOrder =