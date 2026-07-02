"""
Pydantic schemas — Motor de Ingesta Universal STHENOVA.

Cubren:
  - Fuentes (CRUD)
  - Columnas / mapeos
  - Reglas de negocio
  - Lotes (uploads)
  - Registros normalizados
  - Respuesta del detector de IA
  - Respuesta de procesamiento
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────
# COLUMNAS / MAPEO
# ─────────────────────────────────────────────────────────────

class IngestaColumnaBase(BaseModel):
    columna_origen: str
    campo_sthenova: str
    muestra: Optional[str] = None
    confirmada: bool = False
    etiqueta_custom: Optional[str] = None


class IngestaColumnaCreate(IngestaColumnaBase):
    pass


class IngestaColumna(IngestaColumnaBase):
    id: int
    fuente_id: int

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# REGLAS DE NEGOCIO
# ─────────────────────────────────────────────────────────────

class IngestaReglaBase(BaseModel):
    inv_control_temporalidad: bool = True
    inv_alerta_amarilla_dias: int = 90
    inv_alerta_roja_dias: int = 180
    comision_origen: str = "columna"
    comision_porcentaje: Optional[float] = None
    precio_incluye_iva: bool = False
    iva_porcentaje: Optional[float] = 16.0
    dev_columna_estatus: Optional[str] = None
    dev_regla: str = "contiene"
    dev_valor: Optional[str] = None
    dev_fecha_venta_original: bool = True
    dev_ventana_dias: int = 90


class IngestaReglaCreate(IngestaReglaBase):
    pass


class IngestaRegla(IngestaReglaBase):
    id: int
    fuente_id: int

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# FUENTES
# ─────────────────────────────────────────────────────────────

class IngestaFuenteBase(BaseModel):
    nombre: str
    tipo_cliente: Optional[str] = None
    tipo_ingesta: str = "excel"
    moneda: str = "MXN"
    periodicidad: str = "flexible"
    activa: bool = True
    notas: Optional[str] = None
    separador_decimal: str = "punto"
    formato_fecha: str = "DD/MM/YYYY"
    simbolo_moneda: str = "ninguno"
    fila_encabezado: int = 1
    tiene_filas_anidadas: bool = False
    campo_id_pedido: Optional[str] = None
    patron_fila_total: Optional[str] = None
    customer_id: Optional[int] = None
    auto_crear_ventas: bool = False


class IngestaFuenteCreate(IngestaFuenteBase):
    columnas: List[IngestaColumnaCreate] = []
    reglas: Optional[IngestaReglaCreate] = None


class IngestaFuenteUpdate(BaseModel):
    nombre: Optional[str] = None
    tipo_cliente: Optional[str] = None
    tipo_ingesta: Optional[str] = None
    moneda: Optional[str] = None
    periodicidad: Optional[str] = None
    activa: Optional[bool] = None
    notas: Optional[str] = None
    separador_decimal: Optional[str] = None
    formato_fecha: Optional[str] = None
    simbolo_moneda: Optional[str] = None
    fila_encabezado: Optional[int] = None
    tiene_filas_anidadas: Optional[bool] = None
    campo_id_pedido: Optional[str] = None
    patron_fila_total: Optional[str] = None
    columnas: Optional[List[IngestaColumnaCreate]] = None
    reglas: Optional[IngestaReglaCreate] = None
    customer_id: Optional[int] = None
    auto_crear_ventas: Optional[bool] = None


class IngestaFuente(IngestaFuenteBase):
    id: int
    columnas: List[IngestaColumna] = []
    reglas: Optional[IngestaRegla] = None
    api_key: Optional[str] = None
    created_at: Optional[Any] = None
    updated_at: Optional[Any] = None

    class Config:
        from_attributes = True


class IngestaFuenteListItem(BaseModel):
    id: int
    nombre: str
    tipo_cliente: Optional[str] = None
    tipo_ingesta: str
    moneda: str
    periodicidad: str
    activa: bool
    total_lotes: int = 0

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# DETECTOR DE IA
# ─────────────────────────────────────────────────────────────

class ColumnaDetectada(BaseModel):
    """Una columna detectada por la IA con su propuesta de mapeo."""
    columna_origen: str
    campo_sthenova_sugerido: str
    muestra: Optional[str] = None
    confianza: float = Field(ge=0.0, le=1.0)
    razon: Optional[str] = None          # explicación breve de por qué la IA eligió ese campo


class DeteccionRequest(BaseModel):
    """
    Payload para detectar columnas con IA.
    El frontend manda encabezados + muestra de filas del archivo.
    """
    encabezados: List[str]               # nombres de columnas tal como vienen en el archivo
    muestra_filas: List[Dict[str, Any]]  # 3-5 filas de ejemplo {columna: valor}
    fuente_nombre: Optional[str] = None  # hint para la IA ("Walmart México")
    tipo_cliente: Optional[str] = None   # hint adicional


class DeteccionResponse(BaseModel):
    """Respuesta del detector de IA lista para mostrar en el frontend."""
    columnas: List[ColumnaDetectada]
    tiene_filas_anidadas: bool = False
    campo_id_pedido_sugerido: Optional[str] = None
    patron_fila_total_sugerido: Optional[str] = None
    confianza_global: float = 0.0
    notas: Optional[str] = None          # observaciones adicionales de la IA
    tokens_usados: int = 0


# ─────────────────────────────────────────────────────────────
# LOTES (UPLOADS)
# ─────────────────────────────────────────────────────────────

class IngestaLoteBase(BaseModel):
    fuente_id: int
    nombre_archivo: Optional[str] = None
    tipo: str = "excel"
    periodo_inicio: Optional[str] = None
    periodo_fin: Optional[str] = None


class IngestaLote(IngestaLoteBase):
    id: int
    estado: str
    total_filas: int
    filas_ok: int
    filas_error: int
    error_detalle: Optional[str] = None
    created_at: Optional[Any] = None
    updated_at: Optional[Any] = None

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# REGISTROS NORMALIZADOS
# ─────────────────────────────────────────────────────────────

class IngestaRegistro(BaseModel):
    id: int
    lote_id: int
    fuente_id: int
    upc: Optional[str] = None
    sku_cliente: Optional[str] = None
    sku_cadena: Optional[str] = None
    descripcion: Optional[str] = None
    fecha_inicio: Optional[str] = None
    fecha_fin: Optional[str] = None
    fecha_venta: Optional[str] = None
    cantidad_vendida: float = 0.0
    precio_unitario: float = 0.0
    venta_bruta: float = 0.0
    venta_neta: Optional[float] = None
    devoluciones_unidades: float = 0.0
    devoluciones_importe: float = 0.0
    sra: float = 0.0
    bonificaciones: float = 0.0
    descuentos: float = 0.0
    cogs: Optional[float] = None
    comisiones: float = 0.0
    envio: float = 0.0
    marketing: float = 0.0
    inv_inicial: Optional[float] = None
    inv_final: Optional[float] = None
    entradas_resurtido: float = 0.0
    moneda: str = "MXN"
    id_pedido_origen: Optional[str] = None
    estatus_pedido: Optional[str] = None
    order_id: Optional[int] = None
    created_at: Optional[Any] = None

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────
# RESPUESTA DE PROCESAMIENTO DE LOTE
# ─────────────────────────────────────────────────────────────

class ProcesamientoResponse(BaseModel):
    lote_id: int
    fuente_id: int
    estado: str
    total_filas: int
    filas_ok: int
    filas_error: int
    error_detalle: Optional[str] = None
    registros_muestra: List[IngestaRegistro] = []  # primeras 5 filas para preview
    # Si la fuente tiene auto_crear_ventas, el upload también genera las ventas
    # y reporta aquí el resultado (None = la fuente no genera automáticamente).
    ordenes_creadas: Optional[int] = None
    pedidos_ya_existentes: Optional[int] = None
    devoluciones_generadas: Optional[int] = None


# ─────────────────────────────────────────────────────────────
# GENERACIÓN DE VENTAS (Ingesta → Order)
# ─────────────────────────────────────────────────────────────

class GenerarVentasResponse(BaseModel):
    lote_id: int
    ordenes_creadas: int
    registros_omitidos: int  # ya tenían order_id (procesados antes)
    pedidos_ya_existentes: int = 0  # mismo id_pedido_origen ya facturado en un lote anterior: no se duplicó
    devoluciones_generadas: int = 0  # pedidos ya existentes cuyo estatus cambió a devolución/reembolso
    order_ids: List[int] = []


# ─────────────────────────────────────────────────────────────
# WEBHOOK (ingesta tipo "api")
# ─────────────────────────────────────────────────────────────

class WebhookIngestaRequest(BaseModel):
    """Payload que manda el marketplace/cliente vía API: filas crudas, mismo
    formato de columnas que la fuente tiene mapeado (columna_origen -> valor)."""
    filas: List[Dict[str, Any]]
    periodo_inicio: Optional[str] = None
    periodo_fin: Optional[str] = None


# ─────────────────────────────────────────────────────────────
# RESUMEN / DASHBOARD DE INGESTA
# ─────────────────────────────────────────────────────────────

class ResumenIngesta(BaseModel):
    total_fuentes: int
    fuentes_activas: int
    total_lotes: int
    ultimo_lote_fecha: Optional[Any] = None
    total_registros: int
    registros_ultimo_lote: int
