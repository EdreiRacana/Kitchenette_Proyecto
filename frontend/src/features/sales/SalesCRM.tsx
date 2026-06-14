import React from "react";
import {
  Search,
  ChevronRight,
  X,
  CheckCircle,
  XCircle,
  List,
  Columns,
  TrendingUp,
  Clock,
  DollarSign,
  Percent,
} from "lucide-react";

interface OrderItem {
  product: string;
  qty: number;
  unitPrice: number;
}

interface StatusHistoryEntry {
  status: string;
  date: string;
}

interface Order {
  id: number;
  folio: string;
  client: string;
  date: string;
  total: number;
  status: string;
  seller: string;
  paymentMethod: string;
  notes: string;
  items: OrderItem[];
  statusHistory: StatusHistoryEntry[];
}

const ORDERS: Order[] = [
  {
    id: 1, folio: "ORD-001", client: "Restaurante El Fogón", date: "2024-01-15",
    total: 4500, status: "Pagado", seller: "María López", paymentMethod: "Transferencia",
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
    id: 2, folio: "ORD-002", client: "Taquería Los Compadres", date: "2024-01-16",
    total: 2300, status: "Pendiente", seller: "Carlos Ruiz", paymentMethod: "Efectivo",
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
    id: 3, folio: "ORD-003", client: "Hotel Gran Plaza", date: "2024-01-17",
    total: 8750, status: "Parcial", seller: "María López", paymentMethod: "Crédito",
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
    id: 4, folio: "ORD-004", client: "Catering Eventos MX", date: "2024-01-18",
    total: 5600, status: "Pagado", seller: "Ana Torres", paymentMethod: "Tarjeta",
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
    id: 5, folio: "ORD-005", client: "Mariscos El Puerto", date: "2024-01-19",
    total: 3200, status: "Pendiente", seller: "Carlos Ruiz", paymentMethod: "Transferencia",
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
    id: 6, folio: "ORD-006", client: "Buffet Familiar Juárez", date: "2024-01-20",
    total: 1950, status: "Borrador", seller: "Ana Torres", paymentMethod: "Efectivo",
    notes: "Por confirmar cantidades.",
    items: [
      { product: "Carne de cerdo", qty: 5, unitPrice: 200 },
      { product: "Chorizo artesanal", qty: 4, unitPrice: 150 },
      { product: "Longaniza", qty: 3, unitPrice: 130 },
    ],
    statusHistory: [{ status: "Borrador", date: "2024-01-20 10:00" }],
  },
];

const PIPELINE_COLS = ["Borrador", "Pendiente", "Parcial", "Pagado"];

export default function SalesCRM({ t, s }: { t: any; s: any }) {
  const [orders, setOrders] = React.useState<Order[]>(ORDERS);
  const [search, setSearch] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("Todos");
  const [filterFrom, setFilterFrom] = React.useState("");
  const [filterTo, setFilterTo] = React.useState("");
  const [selectedOrder, setSelectedOrder] = React.useState<Order | null>(null);
  const [view, setView] = React.useState<"list" | "pipeline">("list");
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedOrder(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  const totalSold = orders.filter((o) => o.status === "Pagado").reduce((a, b) => a + b.total, 0);
  const pendingOrders = orders.filter((o) => o.status === "Pendiente" || o.status === "Parcial").length;
  const pendingAmount = orders.filter((o) => o.status === "Pendiente" || o.status === "Parcial").reduce((a, b) => a + b.total, 0);
  const paidRate = Math.round((orders.filter((o) => o.status === "Pagado").length / orders.length) * 100);

  const statusColor = (status: string) => {
    const good = t.good || "#34D399";
    const warn = t.warn || "#FBBF24";
    const nova = t.nova || "#33B2F5";
    const bad = t.bad || "#F87171";
    const textLo = t.textLo || "#7C9AD0";
    if (status === "Pagado") return { bg: good + "22", text: good, border: good + "44" };
    if (status === "Pendiente") return { bg: warn + "22", text: warn, border: warn + "44" };
    if (status === "Parcial") return { bg: nova + "22", text: nova, border: nova + "44" };
    if (status === "Cancelado") return { bg: bad + "22", text: bad, border: bad + "44" };
    return { bg: t.panel3 || "#1A2856", text: textLo, border: t.border || "#1E2E5C" };
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      Borrador: "Borrador",
      Pendiente: "Pendiente",
      Parcial: "Parcial",
      Pagado: "Pagado",
      Cancelado: "Cancelado",
    };
    return map[status] || status;
  };

  const now = () =>
    new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 16);

  const markAsPaid = (id: number) => {
    const ts = now();
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status: "Pagado", statusHistory: [...o.statusHistory, { status: "Pagado", date: ts }] }
          : o
      )
    );
    setSelectedOrder((prev) =>
      prev && prev.id === id
        ? { ...prev, status: "Pagado", statusHistory: [...prev.statusHistory, { status: "Pagado", date: ts }] }
        : prev
    );
  };

  const cancelOrder = (id: number) => {
    if (!window.confirm("¿Cancelar este pedido?")) return;
    const ts = now();
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status: "Cancelado", statusHistory: [...o.statusHistory, { status: "Cancelado", date: ts }] }
          : o
      )
    );
    setSelectedOrder((prev) =>
      prev && prev.id === id
        ? { ...prev, status: "Cancelado", statusHistory: [...prev.statusHistory, { status: "Cancelado", date: ts }] }
        : prev
    );
  };

  const onDragStart = (id: number) => setDragging(id);
  const onDragOver = (e: React.DragEvent, col: string) => { e.preventDefault(); setDragOver(col); };
  const onDrop = (col: string) => {
    if (dragging === null) return;
    const ts = now();
    setOrders((prev) =>
      prev.map((o) =>
        o.id === dragging
          ? { ...o, status: col, statusHistory: [...o.statusHistory, { status: col, date: ts }] }
          : o
      )
    );
    setDragging(null);
    setDragOver(null);
  };

  const panel = t.panel || "#0E1838";
  const panel2 = t.panel2 || "#131F44";
  const panel3 = t.panel3 || "#1A2856";
  const border = t.border || "#1E2E5C";
  const textHi = t.textHi || "#F2F6FF";
  const textMid = t.textMid || "#AFBEDF";
  const textLo = t.textLo || "#7C9AD0";
  const nova = t.nova || "#33B2F5";
  const good = t.good || "#34D399";
  const warn = t.warn || "#FBBF24";
  const inputBg = t.inputBg || "#0A1430";

  const KpiCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) => (
    <div style={{ background: panel, border: `1px solid ${border}`, borderRadius: 12, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 180 }}>
      <div style={{ background: color + "22", color, borderRadius: 10, padding: 10, display: "flex" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, color: textLo, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: textHi }}>{value}</div>
      </div>
    </div>
  );

  const StatusBadge = ({ status }: { status: string }) => {
    const c = statusColor(status);
    return (
      <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
        {statusLabel(status)}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "24px 0" }}>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <KpiCard icon={<DollarSign size={20} />} label="Total vendido" value={`$${totalSold.toLocaleString()}`} color={good} />
        <KpiCard icon={<Clock size={20} />} label="Pedidos pendientes" value={String(pendingOrders)} color={warn} />
        <KpiCard icon={<TrendingUp size={20} />} label="Monto por cobrar" value={`$${pendingAmount.toLocaleString()}`} color={nova} />
        <KpiCard icon={<Percent size={20} />} label="Tasa pagados" value={`${paidRate}%`} color={good} />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative" as const, flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: "absolute" as const, left: 10, top: "50%", transform: "translateY(-50%)", color: textLo }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar folio, cliente o estado..."
            style={{ width: "100%", padding: "8px 12px 8px 34px", borderRadius: 8, border: `1px solid ${border}`, background: inputBg, color: textHi, fontSize: 14, boxSizing: "border-box" as const, outline: "none" }}
          />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: inputBg, color: textHi, fontSize: 14 }}>
          {["Todos", ...PIPELINE_COLS, "Cancelado"].map((st) => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: inputBg, color: textHi, fontSize: 14 }} />
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: inputBg, color: textHi, fontSize: 14 }} />
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setView("list")} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: view === "list" ? nova : inputBg, color: view === "list" ? "#fff" : textMid, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <List size={16} /> Lista
          </button>
          <button onClick={() => setView("pipeline")} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: view === "pipeline" ? nova : inputBg, color: view === "pipeline" ? "#fff" : textMid, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <Columns size={16} /> Pipeline
          </button>
        </div>
      </div>

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ background: panel, border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" as const }}>
            <thead>
              <tr style={{ background: panel2 }}>
                {["Folio", "Cliente", "Fecha", "Vendedor", "Pago", "Total", "Estado", ""].map((h, i) => (
                  <th key={i} style={{ padding: "12px 16px", textAlign: "left" as const, fontSize: 12, fontWeight: 600, color: textLo, borderBottom: `1px solid ${border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => (
                <tr
                  key={o.id}
                  onClick={() => setSelectedOrder(o)}
                  style={{ background: i % 2 === 0 ? panel : panel2, cursor: "pointer" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = panel3)}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? panel : panel2)}
                >
                  <td style={{ padding: "12px 16px", fontSize: 14, color: nova, fontWeight: 600 }}>{o.folio}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: textHi }}>{o.client}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: textMid }}>{o.date}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: textMid }}>{o.seller}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: textMid }}>{o.paymentMethod}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: textHi, fontWeight: 600 }}>${o.total.toLocaleString()}</td>
                  <td style={{ padding: "12px 16px" }}><StatusBadge status={o.status} /></td>
                  <td style={{ padding: "12px 16px" }}><ChevronRight size={16} color={textLo} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: "center" as const, color: textLo, fontSize: 14 }}>Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* PIPELINE VIEW */}
      {view === "pipeline" && (
        <div style={{ display: "flex", gap: 16, overflowX: "auto" as const, paddingBottom: 8 }}>
          {PIPELINE_COLS.map((col) => {
            const colOrders = filtered.filter((o) => o.status === col);
            const colTotal = colOrders.reduce((a, b) => a + b.total, 0);
            const sc = statusColor(col);
            return (
              <div
                key={col}
                onDragOver={(e) => onDragOver(e, col)}
                onDrop={() => onDrop(col)}
                style={{ flex: "0 0 260px", background: dragOver === col ? sc.bg : panel, border: `2px solid ${dragOver === col ? sc.border : border}`, borderRadius: 12, padding: 12, minHeight: 300, transition: "border 0.2s, background 0.2s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, color: sc.text, fontSize: 14 }}>{statusLabel(col)}</span>
                  <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 12, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{colOrders.length}</span>
                </div>
                <div style={{ fontSize: 12, color: textLo, marginBottom: 10 }}>${colTotal.toLocaleString()}</div>
                {colOrders.map((o) => (
                  <div
                    key={o.id}
                    draggable
                    onDragStart={() => onDragStart(o.id)}
                    onClick={() => setSelectedOrder(o)}
                    style={{ background: panel2, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, cursor: "grab", opacity: dragging === o.id ? 0.5 : 1, transition: "opacity 0.2s" }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: nova, marginBottom: 4 }}>{o.folio}</div>
                    <div style={{ fontSize: 12, color: textHi, marginBottom: 4 }}>{o.client}</div>
                    <div style={{ fontSize: 12, color: textMid, marginBottom: 6 }}>{o.date}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: textHi }}>${o.total.toLocaleString()}</div>
                  </div>
                ))}
                {colOrders.length === 0 && (
                  <div style={{ textAlign: "center" as const, color: textLo, fontSize: 12, padding: "24px 0", opacity: 0.6 }}>Sin pedidos</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* DETAIL DRAWER */}
      {selectedOrder && (
        <>
          <div onClick={() => setSelectedOrder(null)} style={{ position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }} />
          <div ref={panelRef} style={{ position: "fixed" as const, top: 0, right: 0, height: "100%", width: 420, maxWidth: "95vw", background: panel, borderLeft: `1px solid ${border}`, zIndex: 50, display: "flex", flexDirection: "column" as const, boxShadow: "-4px 0 24px rgba(0,0,0,0.4)", overflowY: "auto" as const }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 16px", borderBottom: `1px solid ${border}`, position: "sticky" as const, top: 0, background: panel, zIndex: 1 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: textHi }}>{selectedOrder.folio}</div>
                <div style={{ fontSize: 13, color: textMid, marginTop: 2 }}>{selectedOrder.client}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusBadge status={selectedOrder.status} />
                <button onClick={() => setSelectedOrder(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: textLo, display: "flex" }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: "20px 24px", flex: 1, display: "flex", flexDirection: "column" as const, gap: 20 }}>

              {/* Info grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { label: "Fecha", value: selectedOrder.date },
                  { label: "Vendedor", value: selectedOrder.seller },
                  { label: "Método de pago", value: selectedOrder.paymentMethod },
                  { label: "Total", value: `$${selectedOrder.total.toLocaleString()}` },
                ].map((f) => (
                  <div key={f.label} style={{ background: panel2, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: textLo, marginBottom: 4, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>{f.label}</div>
                    <div style={{ fontSize: 14, color: textHi, fontWeight: 600 }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {/* Notes */}
              {selectedOrder.notes && (
                <div style={{ background: panel2, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: textLo, marginBottom: 6, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Notas</div>
                  <div style={{ fontSize: 13, color: textMid, lineHeight: 1.5 }}>{selectedOrder.notes}</div>
                </div>
              )}

              {/* Products */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: textHi, marginBottom: 10 }}>Productos</div>
                <div style={{ background: panel2, borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" as const }}>
                    <thead>
                      <tr>
                        {["Producto", "Cant.", "Precio", "Subtotal"].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: textLo, borderBottom: `1px solid ${border}`, textAlign: "left" as const }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((item, i) => (
                        <tr key={i}>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: textHi }}>{item.product}</td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: textMid }}>{item.qty}</td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: textMid }}>${item.unitPrice.toLocaleString()}</td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: textHi, fontWeight: 600 }}>${(item.qty * item.unitPrice).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={3} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: textHi, borderTop: `1px solid ${border}`, textAlign: "right" as const }}>Total</td>
                        <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: 700, color: nova, borderTop: `1px solid ${border}` }}>${selectedOrder.total.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status history */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: textHi, marginBottom: 10 }}>Historial de estado</div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                  {selectedOrder.statusHistory.map((h, i) => {
                    const sc = statusColor(h.status);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 999, background: sc.text, flexShrink: 0 }} />
                        <div style={{ fontSize: 13, color: textHi, fontWeight: 600 }}>{statusLabel(h.status)}</div>
                        <div style={{ fontSize: 12, color: textLo, marginLeft: "auto" }}>{h.date}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {selectedOrder.status !== "Pagado" && selectedOrder.status !== "Cancelado" && (
              <div style={{ padding: "16px 24px", borderTop: `1px solid ${border}`, display: "flex", gap: 10 }}>
                <button
                  onClick={() => markAsPaid(selectedOrder.id)}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: good, color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                >
                  <CheckCircle size={16} /> Marcar pagado
                </button>
                <button
                  onClick={() => cancelOrder(selectedOrder.id)}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: `1px solid ${border}`, background: "transparent", color: t.bad || "#F87171", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                >
                  <XCircle size={16} /> Cancelar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

