"""Registro declarativo de datasets disponibles para reportes.

Cada dataset declara:
- key: identificador único
- label_es / label_en: display name
- source: función async(db) → SQLAlchemy Select con todos los campos disponibles
- fields: {alias: {label, type, sqla_col}} — permite filtrar por alias,
  ordenar, agrupar y agregar sin exponer nombres reales de columnas al frontend.
- allow_group_by: campos permitidos como grouping
- allow_aggregations: campos numéricos con sus agregaciones soportadas

El motor (engine.py) valida cada request contra este registro. Nunca ejecuta
SQL crudo enviado por el usuario.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession


FieldType = str  # "text" | "number" | "date" | "money" | "int"
AggType = str    # "sum" | "count" | "avg" | "min" | "max"


class DatasetField:
    def __init__(self, alias: str, label_es: str, label_en: str,
                 type: FieldType, sqla_col: Any,
                 allowed_aggs: Optional[List[AggType]] = None):
        self.alias = alias
        self.label_es = label_es
        self.label_en = label_en
        self.type = type
        self.sqla_col = sqla_col
        self.allowed_aggs = allowed_aggs or []


class Dataset:
    def __init__(self, key: str, label_es: str, label_en: str,
                 source_builder: Callable[[], Select],
                 fields: List[DatasetField],
                 groupable_aliases: Optional[List[str]] = None,
                 date_field: Optional[str] = None):
        self.key = key
        self.label_es = label_es
        self.label_en = label_en
        self.source_builder = source_builder
        self.fields = {f.alias: f for f in fields}
        self.groupable = set(groupable_aliases or [a for a, f in self.fields.items()
                                                    if f.type in ("text", "int", "date")])
        self.date_field = date_field   # alias del campo fecha para filter date_from/date_to

    def field(self, alias: str) -> Optional[DatasetField]:
        return self.fields.get(alias)

    def to_dict(self, lang: str = "es") -> dict:
        label_key = "label_es" if lang == "es" else "label_en"
        return {
            "key": self.key,
            "label": getattr(self, label_key),
            "date_field": self.date_field,
            "groupable": sorted(self.groupable),
            "fields": [
                {
                    "alias": f.alias,
                    "label": getattr(f, label_key),
                    "type": f.type,
                    "allowed_aggs": f.allowed_aggs,
                }
                for f in self.fields.values()
            ],
        }


# ─── Registro ───────────────────────────────────────────────────────────

_REGISTRY: Dict[str, Dataset] = {}


def register(ds: Dataset) -> None:
    _REGISTRY[ds.key] = ds


def get(key: str) -> Optional[Dataset]:
    _ensure_loaded()
    return _REGISTRY.get(key)


def all_datasets(lang: str = "es") -> List[dict]:
    _ensure_loaded()
    return [ds.to_dict(lang) for ds in _REGISTRY.values()]


_LOADED = False


def _ensure_loaded():
    global _LOADED
    if _LOADED:
        return
    _register_all()
    _LOADED = True


def _register_all():
    """Registra los datasets al primer uso. Import dentro para evitar
    import circular con los models al startup."""
    from app.modules.accounting import models as acc
    from app.modules.finance import models as fin
    from app.modules.sales import models as sales
    from app.modules.customers import models as cust
    from app.modules.inventory import models as inv

    # ═══ Dataset: Movimientos contables (JournalLine × JournalEntry × Account) ═══
    def _acc_movements_source():
        return (
            select(
                acc.JournalLine.id.label("line_id"),
                acc.JournalLine.debit.label("debit"),
                acc.JournalLine.credit.label("credit"),
                acc.JournalLine.description.label("line_description"),
                acc.JournalEntry.id.label("entry_id"),
                acc.JournalEntry.folio.label("folio"),
                acc.JournalEntry.date.label("date"),
                acc.JournalEntry.concept.label("concept"),
                acc.JournalEntry.entry_type.label("entry_type"),
                acc.JournalEntry.status.label("status"),
                acc.JournalEntry.source.label("source"),
                acc.Account.code.label("account_code"),
                acc.Account.name.label("account_name"),
                acc.Account.account_type.label("account_type"),
                acc.Account.nature.label("account_nature"),
            )
            .join(acc.JournalEntry, acc.JournalLine.entry_id == acc.JournalEntry.id)
            .join(acc.Account, acc.JournalLine.account_id == acc.Account.id)
            .where(acc.JournalEntry.status == "posted")
        )

    register(Dataset(
        key="accounting_movements",
        label_es="Movimientos contables",
        label_en="Journal movements",
        source_builder=_acc_movements_source,
        date_field="date",
        fields=[
            DatasetField("date", "Fecha", "Date", "date", acc.JournalEntry.date),
            DatasetField("folio", "Folio", "Folio", "text", acc.JournalEntry.folio),
            DatasetField("concept", "Concepto", "Concept", "text", acc.JournalEntry.concept),
            DatasetField("entry_type", "Tipo póliza", "Entry type", "text", acc.JournalEntry.entry_type),
            DatasetField("source", "Origen", "Source", "text", acc.JournalEntry.source),
            DatasetField("account_code", "Cuenta código", "Account code", "text", acc.Account.code),
            DatasetField("account_name", "Cuenta nombre", "Account name", "text", acc.Account.name),
            DatasetField("account_type", "Tipo cuenta", "Account type", "text", acc.Account.account_type),
            DatasetField("account_nature", "Naturaleza", "Nature", "text", acc.Account.nature),
            DatasetField("line_description", "Descripción línea", "Line desc", "text", acc.JournalLine.description),
            DatasetField("debit", "Cargo", "Debit", "money", acc.JournalLine.debit, ["sum", "avg", "min", "max"]),
            DatasetField("credit", "Abono", "Credit", "money", acc.JournalLine.credit, ["sum", "avg", "min", "max"]),
            DatasetField("line_id", "ID línea", "Line ID", "int", acc.JournalLine.id, ["count"]),
        ],
    ))

    # ═══ Dataset: Ventas (Order) ═══
    def _sales_orders_source():
        return (
            select(
                sales.Order.id.label("order_id"),
                sales.Order.folio.label("folio"),
                sales.Order.kind.label("kind"),
                sales.Order.status.label("status"),
                sales.Order.channel.label("channel"),
                sales.Order.created_at.label("date"),
                sales.Order.subtotal.label("subtotal"),
                sales.Order.tax_amount.label("tax_amount"),
                sales.Order.total_amount.label("total"),
                sales.Order.paid_amount.label("paid"),
                cust.Customer.name.label("customer_name"),
                cust.Customer.estado.label("customer_state"),
                cust.Customer.relationship_type.label("customer_type"),
            )
            .outerjoin(cust.Customer, sales.Order.customer_id == cust.Customer.id)
        )

    register(Dataset(
        key="sales_orders",
        label_es="Ventas / Órdenes",
        label_en="Sales / Orders",
        source_builder=_sales_orders_source,
        date_field="date",
        fields=[
            DatasetField("date", "Fecha", "Date", "date", sales.Order.created_at),
            DatasetField("folio", "Folio", "Folio", "text", sales.Order.folio),
            DatasetField("kind", "Tipo", "Kind", "text", sales.Order.kind),
            DatasetField("status", "Estado", "Status", "text", sales.Order.status),
            DatasetField("channel", "Canal", "Channel", "text", sales.Order.channel),
            DatasetField("customer_name", "Cliente", "Customer", "text", cust.Customer.name),
            DatasetField("customer_state", "Estado (cliente)", "State", "text", cust.Customer.estado),
            DatasetField("customer_type", "Tipo cliente", "Customer type", "text", cust.Customer.relationship_type),
            DatasetField("subtotal", "Subtotal", "Subtotal", "money", sales.Order.subtotal, ["sum", "avg", "min", "max"]),
            DatasetField("tax_amount", "IVA", "Tax", "money", sales.Order.tax_amount, ["sum", "avg"]),
            DatasetField("total", "Total", "Total", "money", sales.Order.total_amount, ["sum", "avg", "min", "max"]),
            DatasetField("paid", "Pagado", "Paid", "money", sales.Order.paid_amount, ["sum", "avg"]),
            DatasetField("order_id", "ID orden", "Order ID", "int", sales.Order.id, ["count"]),
        ],
    ))

    # ═══ Dataset: Transacciones (Finance.Transaction) ═══
    def _transactions_source():
        return select(
            fin.Transaction.id.label("tx_id"),
            fin.Transaction.type.label("type"),
            fin.Transaction.amount.label("amount"),
            fin.Transaction.category.label("category"),
            fin.Transaction.description.label("description"),
            fin.Transaction.reference.label("reference"),
            fin.Transaction.created_at.label("date"),
        )

    register(Dataset(
        key="transactions",
        label_es="Transacciones financieras",
        label_en="Financial transactions",
        source_builder=_transactions_source,
        date_field="date",
        fields=[
            DatasetField("date", "Fecha", "Date", "date", fin.Transaction.created_at),
            DatasetField("type", "Tipo", "Type", "text", fin.Transaction.type),
            DatasetField("category", "Categoría", "Category", "text", fin.Transaction.category),
            DatasetField("description", "Descripción", "Description", "text", fin.Transaction.description),
            DatasetField("reference", "Referencia", "Reference", "text", fin.Transaction.reference),
            DatasetField("amount", "Monto", "Amount", "money", fin.Transaction.amount, ["sum", "avg", "min", "max"]),
            DatasetField("tx_id", "ID", "ID", "int", fin.Transaction.id, ["count"]),
        ],
    ))

    # ═══ Dataset: Cuentas por Pagar (SupplierBill) ═══
    def _cxp_source():
        return (
            select(
                fin.SupplierBill.id.label("bill_id"),
                fin.SupplierBill.folio.label("folio"),
                fin.SupplierBill.supplier_folio.label("supplier_folio"),
                fin.SupplierBill.issue_date.label("date"),
                fin.SupplierBill.due_date.label("due_date"),
                fin.SupplierBill.category.label("category"),
                fin.SupplierBill.subtotal.label("subtotal"),
                fin.SupplierBill.tax_amount.label("tax_amount"),
                fin.SupplierBill.total_amount.label("total"),
                fin.SupplierBill.paid_amount.label("paid"),
                fin.SupplierBill.status.label("status"),
                inv.Supplier.name.label("supplier_name"),
                inv.Supplier.rfc.label("supplier_rfc"),
            )
            .outerjoin(inv.Supplier, fin.SupplierBill.supplier_id == inv.Supplier.id)
        )

    register(Dataset(
        key="accounts_payable",
        label_es="Cuentas por Pagar (facturas proveedor)",
        label_en="Accounts Payable (supplier bills)",
        source_builder=_cxp_source,
        date_field="date",
        fields=[
            DatasetField("date", "Fecha emisión", "Issue date", "date", fin.SupplierBill.issue_date),
            DatasetField("due_date", "Vencimiento", "Due date", "date", fin.SupplierBill.due_date),
            DatasetField("folio", "Folio interno", "Folio", "text", fin.SupplierBill.folio),
            DatasetField("supplier_folio", "Folio proveedor", "Supplier folio", "text", fin.SupplierBill.supplier_folio),
            DatasetField("supplier_name", "Proveedor", "Supplier", "text", inv.Supplier.name),
            DatasetField("supplier_rfc", "RFC", "RFC", "text", inv.Supplier.rfc),
            DatasetField("category", "Categoría", "Category", "text", fin.SupplierBill.category),
            DatasetField("status", "Estado", "Status", "text", fin.SupplierBill.status),
            DatasetField("subtotal", "Subtotal", "Subtotal", "money", fin.SupplierBill.subtotal, ["sum", "avg"]),
            DatasetField("tax_amount", "IVA", "Tax", "money", fin.SupplierBill.tax_amount, ["sum"]),
            DatasetField("total", "Total", "Total", "money", fin.SupplierBill.total_amount, ["sum", "avg", "min", "max"]),
            DatasetField("paid", "Pagado", "Paid", "money", fin.SupplierBill.paid_amount, ["sum"]),
            DatasetField("bill_id", "ID", "ID", "int", fin.SupplierBill.id, ["count"]),
        ],
    ))
