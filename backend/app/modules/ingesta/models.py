"""
Motor de Ingesta Universal — modelos de base de datos v2.

Tablas:
  - ingesta_fuentes   : perfil completo de cada cadena/canal
  - ingesta_columnas  : mapeo columna_archivo → campo_sthenova
  - ingesta_reglas    : reglas de negocio (comisión, IVA, devoluciones, estructura)
  - ingesta_lotes     : cada archivo subido
  - ingesta_registros : filas normalizadas listas para ventas y BI

Filosofía (alineada con SAP/NetSuite):
  - COGS y Marketing NO vienen del reporte de ventas.
    Vienen de Compras/Producción y Gastos respectivamente.
    El módulo de BI los cruza para calcular el margen.
  - Este módulo solo normaliza lo que trae el reporte de la cadena.
"""

from sqlalchemy import (
    Column, Integer, String, Float, Boolean,
    DateTime, Text, ForeignKey, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class IngestaFuente(Base):
    """Perfil completo de una fuente de datos."""

    __tablename__ = "ingesta_fuentes"

    id            = Column(Integer, primary_key=True, index=True)
    nombre        = Column(String,  nullable=False)
    tipo_cliente  = Column(String,  nullable=True)   # marketplace | cadena_retail | tienda_fisica | distribuidor | web_propia
    tipo_ingesta  = Column(String,  default="excel")  # excel | csv | api
    moneda        = Column(String,  default="MXN")    # MXN | USD
    periodicidad  = Column(String,  default="flexible")
    activa        = Column(Boolean, default=True)
    notas         = Column(Text,    nullable=True)

    # ── Formato del archivo ──────────────────────────────────────────────
    separador_decimal = Column(String,  default="punto")      # punto | coma
    formato_fecha     = Column(String,  default="YYYY-MM-DD")
    simbolo_moneda    = Column(String,  default="ninguno")    # ninguno | signo | texto
    fila_encabezado   = Column(Integer, default=1)
    nombre_hoja       = Column(String,  nullable=True)        # hoja de Excel si aplica

    # ── Estructura anidada (MeLi, Amazon: varias filas por pedido) ───────
    tiene_filas_anidadas  = Column(Boolean, default=False)
    campo_id_pedido       = Column(String,  nullable=True)   # columna que agrupa filas
    patron_fila_total     = Column(String,  nullable=True)   # valor que identifica fila de total

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    columnas = relationship("IngestaColumna", back_populates="fuente", cascade="all, delete-orphan")
    reglas   = relationship("IngestaRegla",   back_populates="fuente", uselist=False, cascade="all, delete-orphan")
    lotes    = relationship("IngestaLote",    back_populates="fuente", cascade="all, delete-orphan")


# ── Campos internos estándar STHENOVA ────────────────────────────────────────
# COGS y marketing NO están aquí — vienen de Compras/Producción y Gastos.
CAMPOS_STHENOVA = {
    # ── Identificadores de producto ───────────────────────────────────────
    "upc":                   "UPC / código de barras (EAN/GTIN — universal)",
    "sku_cliente":           "SKU interno del cliente (código propio de la empresa)",
    "sku_cadena":            "SKU de la cadena (código que asigna el marketplace o cadena)",
    "descripcion":           "Nombre o descripción del producto",
    "variante":              "Variante del producto (color, talla, presentación)",
    "subcategoria":          "Subcategoría del producto",
    # ── Pedido / documento ────────────────────────────────────────────────
    "id_pedido":             "ID del pedido o número de orden",
    "estatus_pedido":        "Estatus del pedido (enviado, entregado, cancelado, etc.)",
    "canal_venta":           "Canal de venta (app, web, mostrador, etc.)",
    "metodo_envio":          "Método o modalidad de envío",
    # ── Fechas ────────────────────────────────────────────────────────────
    "fecha_venta":           "Fecha de la venta o creación del pedido",
    "fecha_inicio":          "Fecha de inicio del periodo reportado",
    "fecha_fin":             "Fecha de fin del periodo reportado",
    "fecha_entrega":         "Fecha de entrega al cliente final",
    # ── Ventas (ingresos) ─────────────────────────────────────────────────
    "cantidad_vendida":      "Unidades vendidas (piezas, cajas, etc.)",
    "precio_unitario":       "Precio de venta por unidad",
    "venta_bruta":           "Ingreso bruto total (precio × cantidad, antes de deducciones)",
    "venta_neta":            "Ingreso neto (después de todas las deducciones de la cadena)",
    # ── Deducciones / contra-ingresos ─────────────────────────────────────
    "comision":              "Comisión del marketplace o cadena sobre la venta",
    "costo_logistico":       "Costo de envío o logística cobrado por la cadena",
    "devoluciones_importe":  "Importe monetario de devoluciones / reembolsos",
    "devoluciones_unidades": "Unidades devueltas",
    "sra":                   "Shrink, Returns & Allowances — mermas y ajustes",
    "bonificaciones":        "Bonificaciones o allowances otorgados a la cadena",
    "descuentos":            "Descuentos aplicados sobre el precio de venta",
    # ── Inventario en cadena ──────────────────────────────────────────────
    "inv_inicial":           "Inventario inicial del periodo en tienda / CEDIS",
    "inv_final":             "Inventario final del periodo en tienda / CEDIS",
    "entradas_resurtido":    "Unidades de resurtido recibidas en el periodo",
    # ── Campo extra personalizado ─────────────────────────────────────────
    "campo_extra_1":         "Campo personalizado 1 (definido por el cliente)",
    "campo_extra_2":         "Campo personalizado 2 (definido por el cliente)",
    "campo_extra_3":         "Campo personalizado 3 (definido por el cliente)",
    # ── Ignorar ───────────────────────────────────────────────────────────
    "skip":                  "Ignorar esta columna",
}


class IngestaColumna(Base):
    """Mapeo: columna del archivo → campo interno STHENOVA."""

    __tablename__ = "ingesta_columnas"

    id          = Column(Integer, primary_key=True, index=True)
    fuente_id   = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, index=True)
    columna_origen   = Column(String,  nullable=False)   # nombre exacto en el archivo
    campo_sthenova   = Column(String,  nullable=False)   # clave del dict CAMPOS_STHENOVA
    muestra          = Column(String,  nullable=True)    # valor de ejemplo
    confirmada       = Column(Boolean, default=True)     # el usuario confirmó este mapeo
    # Para campos extra personalizados
    etiqueta_custom  = Column(String,  nullable=True)    # nombre que le da el cliente al campo extra

    fuente = relationship("IngestaFuente", back_populates="columnas")


class IngestaRegla(Base):
    """
    Reglas de negocio por fuente.
    Cubre: comisión, IVA, devoluciones, inventario.
    """

    __tablename__ = "ingesta_reglas"

    id        = Column(Integer, primary_key=True, index=True)
    fuente_id = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, unique=True, index=True)

    # ── Comisión ─────────────────────────────────────────────────────────
    # origen: columna | porcentaje | no_aplica
    comision_origen      = Column(String,  default="columna")
    comision_porcentaje  = Column(Float,   nullable=True)   # ej: 17.0 (= 17%)
    # Si es columna, el mapeo ya está en IngestaColumna con campo_sthenova="comision"

    # ── IVA ──────────────────────────────────────────────────────────────
    precio_incluye_iva   = Column(Boolean, default=False)
    iva_porcentaje       = Column(Float,   default=16.0)    # % a quitar si precio_incluye_iva=True

    # ── Devoluciones ─────────────────────────────────────────────────────
    # La devolución se detecta por una columna de estatus
    dev_columna_estatus  = Column(String,  nullable=True)   # nombre de la columna de estatus
    # regla: contiene | igual | diferente
    dev_regla            = Column(String,  default="contiene")
    dev_valor            = Column(String,  nullable=True)   # texto que identifica devolución
    # Doble fecha: imputar a fecha de venta original (estadística) + fecha de aplicación (contable)
    dev_fecha_venta_original = Column(Boolean, default=True)
    dev_ventana_dias         = Column(Integer,  default=90)

    # ── Inventario ───────────────────────────────────────────────────────
    inv_control_temporalidad = Column(Boolean, default=True)
    inv_alerta_amarilla_dias = Column(Integer,  default=90)
    inv_alerta_roja_dias     = Column(Integer,  default=180)

    fuente = relationship("IngestaFuente", back_populates="reglas")


class IngestaLote(Base):
    """Un archivo subido para una fuente."""

    __tablename__ = "ingesta_lotes"

    id             = Column(Integer, primary_key=True, index=True)
    fuente_id      = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, index=True)
    nombre_archivo = Column(String,  nullable=True)
    tipo           = Column(String,  default="excel")      # excel | csv
    estado         = Column(String,  default="pendiente")  # pendiente | procesando | ok | error
    total_filas    = Column(Integer, default=0)
    filas_ok       = Column(Integer, default=0)
    filas_error    = Column(Integer, default=0)
    error_detalle  = Column(Text,    nullable=True)
    periodo_inicio = Column(String,  nullable=True)
    periodo_fin    = Column(String,  nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), onupdate=func.now())

    fuente    = relationship("IngestaFuente", back_populates="lotes")
    registros = relationship("IngestaRegistro", back_populates="lote", cascade="all, delete-orphan")


class IngestaRegistro(Base):
    """
    Fila normalizada lista para ventas y BI.
    COGS y marketing NO están aquí — vienen de Compras/Producción y Gastos.
    """

    __tablename__ = "ingesta_registros"

    id        = Column(Integer, primary_key=True, index=True)
    lote_id   = Column(Integer, ForeignKey("ingesta_lotes.id"),   nullable=False, index=True)
    fuente_id = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, index=True)

    # ── Identificadores ──────────────────────────────────────────────────
    upc          = Column(String, nullable=True, index=True)
    sku_cliente  = Column(String, nullable=True, index=True)
    sku_cadena   = Column(String, nullable=True)
    descripcion  = Column(String, nullable=True)
    variante     = Column(String, nullable=True)
    subcategoria = Column(String, nullable=True)

    # ── Pedido ────────────────────────────────────────────────────────────
    id_pedido_origen = Column(String, nullable=True, index=True)
    estatus_pedido   = Column(String, nullable=True, index=True)
    canal_venta      = Column(String, nullable=True)
    metodo_envio     = Column(String, nullable=True)

    # ── Fechas ────────────────────────────────────────────────────────────
    fecha_venta  = Column(String, nullable=True, index=True)  # YYYY-MM-DD
    fecha_inicio = Column(String, nullable=True)
    fecha_fin    = Column(String, nullable=True)
    fecha_entrega= Column(String, nullable=True)

    # ── Ventas ────────────────────────────────────────────────────────────
    cantidad_vendida = Column(Float, default=0.0)
    precio_unitario  = Column(Float, default=0.0)
    venta_bruta      = Column(Float, default=0.0)
    venta_neta       = Column(Float, nullable=True)

    # ── Deducciones ───────────────────────────────────────────────────────
    comision             = Column(Float, default=0.0)
    costo_logistico      = Column(Float, default=0.0)
    devoluciones_importe = Column(Float, default=0.0)
    devoluciones_unidades= Column(Float, default=0.0)
    sra                  = Column(Float, default=0.0)
    bonificaciones       = Column(Float, default=0.0)
    descuentos           = Column(Float, default=0.0)

    # ── Inventario en cadena ──────────────────────────────────────────────
    inv_inicial       = Column(Float, nullable=True)
    inv_final         = Column(Float, nullable=True)
    entradas_resurtido= Column(Float, default=0.0)

    # ── Campos extra personalizados ───────────────────────────────────────
    campo_extra_1 = Column(String, nullable=True)
    campo_extra_2 = Column(String, nullable=True)
    campo_extra_3 = Column(String, nullable=True)

    # ── Metadatos ─────────────────────────────────────────────────────────
    moneda        = Column(String, default="MXN")
    es_devolucion = Column(Boolean, default=False, index=True)  # detectado por regla
    datos_crudos  = Column(JSON,   nullable=True)               # fila original para auditoría

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lote   = relationship("IngestaLote",   back_populates="registros")
