from __future__ import annotations
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict
from datetime import datetime


class POSTerminalCreate(BaseModel):
    name: str
    code: Optional[str] = None
    warehouse_id: Optional[int] = None
    printer_ip: Optional[str] = None
    default_price_list: Optional[str] = None
    is_active: bool = True
    notes: Optional[str] = None


class POSTerminalUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    warehouse_id: Optional[int] = None
    printer_ip: Optional[str] = None
    default_price_list: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class POSTerminalOut(POSTerminalCreate):
    id: int
    warehouse_name: Optional[str] = None
    created_at: datetime
    open_session_id: Optional[int] = None
    open_cashier_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class OpenSessionRequest(BaseModel):
    terminal_id: int
    opening_balance: float = 0.0
    opening_notes: Optional[str] = None


class CashMovementRequest(BaseModel):
    session_id: int
    type: str  # cash_in | cash_out
    amount: float
    notes: Optional[str] = None


class POSSaleItemInput(BaseModel):
    variant_id: Optional[int] = None
    product_name: str
    sku: Optional[str] = None
    quantity: int
    unit_price: float
    discount_amount: float = 0.0
    tax_rate: float = 16.0
    is_service: bool = False


class POSSaleRequest(BaseModel):
    session_id: int
    customer_id: Optional[int] = None      # None = "público en general"
    items: List[POSSaleItemInput]
    payments: Dict[str, float] = {}         # {"cash": 500, "card": 300}
    discount_amount: float = 0.0
    tax_rate: float = 16.0
    shipping_amount: float = 0.0
    notes: Optional[str] = None


class CloseSessionRequest(BaseModel):
    session_id: int
    denominations: Dict[str, int]  # {"1000": 2, "500": 5, ...}
    closing_notes: Optional[str] = None


class POSSessionOut(BaseModel):
    id: int
    terminal_id: int
    terminal_name: str
    cashier_id: int
    cashier_name: str
    status: str
    opened_at: datetime
    opening_balance: float
    closed_at: Optional[datetime] = None
    expected_cash: float
    actual_cash: float
    variance: float
    total_sales_amount: float
    total_sales_count: int
    total_cash_in: float
    total_cash_out: float
    total_refunds: float
    denominations_json: Optional[Dict[str, int]] = None
    opening_notes: Optional[str] = None
    closing_notes: Optional[str] = None


class POSSessionReport(POSSessionOut):
    """Reporte detallado del turno con ventas por método de pago."""
    sales_by_method: Dict[str, float]  # {"cash": 12500, "card": 3200}
    transactions: List[dict]
    # Reconciliación post-cierre (derivados dinámicos)
    total_deposited: float = 0.0        # efectivo llevado al banco tras cerrar
    total_float_next: float = 0.0       # efectivo dejado para el siguiente turno
    total_adjustments: float = 0.0      # ajustes registrados con motivo
    cash_remaining_after: float = 0.0   # actual_cash - deposits - floats


class ReconcileMovementRequest(BaseModel):
    """Movimiento post-cierre para reconciliar un turno ya cerrado.

    Tipos válidos:
      • bank_deposit    → efectivo llevado al banco (crea BankTransaction).
      • float_next_shift→ efectivo dejado como fondo del siguiente turno.
      • adjustment      → ajuste con motivo (sobrante/faltante justificado).
    """
    type: str  # bank_deposit | float_next_shift | adjustment
    amount: float
    notes: Optional[str] = None
    bank_account_id: Optional[int] = None  # requerido si type=bank_deposit


class UpdateSessionNotesRequest(BaseModel):
    closing_notes: Optional[str] = None
    opening_notes: Optional[str] = None


class RecountRequest(BaseModel):
    """Reingresa el arqueo tras el cierre — cuando el cajero olvidó o
    contó mal. Recalcula actual_cash y variance con audit log."""
    denominations: Dict[str, int]  # {"500": 4, "200": 5, ...}
    notes: Optional[str] = None
