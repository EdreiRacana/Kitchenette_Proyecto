"""
Motor de Ingesta Universal — modelos de base de datos.

Tablas:
  - ingesta_fuentes        : perfil de cada cadena/canal (Walmart, MeLi, etc.)
  - ingesta_columnas       : mapeo columna_archivo → campo_sthenova por fuente
  - ingesta_reglas         : reglas de negocio por fuente (devoluciones, estructura)
  - ingesta_lotes          : cada archivo/batch subido
  - ingesta_registros      : filas normalizadas resultado de un lote

Diseño:
  - Una fuente puede tener muchos lotes (historial de cargas).
  - Cada lote produce N registros normalizados.
  - Los registros normalizados alimentan ventas, inventario y BI.
  - Todo es por tenant (empresa), listo para modelo multi-instancia.
"""

from sqlalchemy import (
    Column, Integer, String, Float, Boolean,
    DateTime, Text, ForeignKey, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class IngestaFuente(Base):
    """Perfil de una fuente de datos (cadena, marketplace, distribuidor, etc.)."""

    __tablename__ = "ingesta_fuentes"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)               # "Walmart México"
    tipo_cliente = Column(String, nullable=True)          # cadena_retail | marketplace | tienda | distribuidor
    tipo_ingesta = Column(String, default="excel")        # excel | api | ambas
    moneda = Column(String, default="MXN")               # MXN | USD | ambas
    periodicidad = Column(String, default="flexible")    # diaria | semanal | quincenal | mensual | flexible
    activa = Column(Boolean, default=True)
    notas = Column(Text, nullable=True)

    # Formato del archivo
    separador_decimal = Column(String, default="punto")  # punto | coma
    formato_fecha = Column(String, default="DD/MM/YYYY")
    simbolo_moneda = Column(String, default="ninguno")   # ninguno | signo | texto
    fila_encabezado = Column(Integer, default=1)

    # Estructura especial (Mercado Libre, Amazon)
    tiene_filas_anidadas = Column(Boolean, default=False)
    campo_id_pedido = Column(String, nullable=True)       # columna que agrupa filas del mismo pedido
    patron_fila_total = Column(String, nullable=True)     # texto que identifica la fila de total (ej: "TOTAL", "")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    columnas = relationship("IngestaColumna", back_populates="fuente", cascade="all, delete-orphan")
    reglas = relationship("IngestaRegla", back_populates="fuente", uselist=False, cascade="all, delete-orphan")
    lotes = relationship("IngestaLote", back_populates="fuente", cascade="all, delete-orphan")


class IngestaColumna(Base):
    """
    Mapeo: columna_archivo (nombre que usa la cadena) → campo_sthenova (nombre interno).
    Una fuente tiene N columnas mapeadas.
    """

    __tablename__ = "ingesta_columnas"

    id = Column(Integer, primary_key=True, index=True)
    fuente_id = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, index=True)

    # Nombre tal como aparece en el archivo de la cadena
    columna_origen = Column(String, nullable=False)       # "Unidades vendidas", "units_ordered", "Qty"

    # Campo interno estándar de STHENOVA
    campo_sthenova = Column(String, nullable=False)       # "cantidad_vendida", "venta_bruta", "skip"

    # Metadatos de ayuda
    muestra = Column(String, nullable=True)               # valor de ejemplo detectado
    confianza = Column(Float, default=1.0)                # 0-1, qué tan seguro fue el match de IA
    confirmada = Column(Boolean, default=False)           # el usuario confirmó este mapeo

    fuente = relationship("IngestaFuente", back_populates="columnas")


# Campos internos estándar de STHENOVA (valores válidos para campo_sthenova)
CAMPOS_STHENOVA = [
    # Identificadores
    "upc",
    "sku_cliente",
    "sku_cadena",
    "descripcion",
    # Fechas
    "fecha_inicio",
    "fecha_fin",
    "fecha_venta",
    # Ventas
    "cantidad_vendida",
    "precio_unitario",
    "venta_bruta",
    "venta_neta",
    # Deducciones (contra-ingreso)
    "devoluciones_unidades",
    "devoluciones_importe",
    "sra",
    "bonificaciones",
    "descuentos",
    # Costos
    "cogs",
    "comisiones",
    "envio",
    "marketing",
    # Inventario
    "inv_inicial",
    "inv_final",
    "entradas_resurtido",
    "salidas_venta",
    # Pedido (para fuentes con estructura anidada tipo MeLi)
    "id_pedido",
    "es_fila_total",
    "costo_envio_pedido",
    # Ignorar
    "skip",
]


class IngestaRegla(Base):
    """Reglas de negocio por fuente: devoluciones, inventario, estructura."""

    __tablename__ = "ingesta_reglas"

    id = Column(Integer, primary_key=True, index=True)
    fuente_id = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, unique=True, index=True)

    # Devoluciones
    devolucion_fecha_venta = Column(Boolean, default=True)   # imputar a fecha de venta original
    devolucion_acepta_huerfanas = Column(Boolean, default=True)
    devolucion_ventana_dias = Column(Integer, default=90)

    # Inventario
    inv_control_temporalidad = Column(Boolean, default=True)
    inv_alerta_amarilla_dias = Column(Integer, default=90)
    inv_alerta_roja_dias = Column(Integer, default=180)

    fuente = relationship("IngestaFuente", back_populates="reglas")


class IngestaLote(Base):
    """Un archivo o batch subido para una fuente."""

    __tablename__ = "ingesta_lotes"

    id = Column(Integer, primary_key=True, index=True)
    fuente_id = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, index=True)

    nombre_archivo = Column(String, nullable=True)
    tipo = Column(String, default="excel")               # excel | csv | api
    estado = Column(String, default="pendiente")         # pendiente | procesando | ok | error
    total_filas = Column(Integer, default=0)
    filas_ok = Column(Integer, default=0)
    filas_error = Column(Integer, default=0)
    error_detalle = Column(Text, nullable=True)
    periodo_inicio = Column(String, nullable=True)       # YYYY-MM-DD
    periodo_fin = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    fuente = relationship("IngestaFuente", back_populates="lotes")
    registros = relationship("IngestaRegistro", back_populates="lote", cascade="all, delete-orphan")


class IngestaRegistro(Base):
    """
    Fila normalizada resultado de un lote.
    Almacena los campos estándar de STHENOVA listos para alimentar
    ventas, inventario y BI.
    """

    __tablename__ = "ingesta_registros"

    id = Column(Integer, primary_key=True, index=True)
    lote_id = Column(Integer, ForeignKey("ingesta_lotes.id"), nullable=False, index=True)
    fuente_id = Column(Integer, ForeignKey("ingesta_fuentes.id"), nullable=False, index=True)

    # Identificadores
    upc = Column(String, nullable=True, index=True)
    sku_cliente = Column(String, nullable=True)
    sku_cadena = Column(String, nullable=True)
    descripcion = Column(String, nullable=True)

    # Periodo
    fecha_inicio = Column(String, nullable=True)         # YYYY-MM-DD
    fecha_fin = Column(String, nullable=True)
    fecha_venta = Column(String, nullable=True)

    # Ventas
    cantidad_vendida = Column(Float, default=0.0)
    precio_unitario = Column(Float, default=0.0)
    venta_bruta = Column(Float, default=0.0)
    venta_neta = Column(Float, nullable=True)

    # Deducciones
    devoluciones_unidades = Column(Float, default=0.0)
    devoluciones_importe = Column(Float, default=0.0)
    sra = Column(Float, default=0.0)
    bonificaciones = Column(Float, default=0.0)
    descuentos = Column(Float, default=0.0)

    # Costos
    cogs = Column(Float, nullable=True)
    comisiones = Column(Float, default=0.0)
    envio = Column(Float, default=0.0)
    marketing = Column(Float, default=0.0)

    # Inventario
    inv_inicial = Column(Float, nullable=True)
    inv_final = Column(Float, nullable=True)
    entradas_resurtido = Column(Float, default=0.0)

    # Moneda y fuente
    moneda = Column(String, default="MXN")
    id_pedido_origen = Column(String, nullable=True)     # ID original del pedido en la cadena

    # Datos crudos por si se necesita auditoría
    datos_crudos = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lote = relationship("IngestaLote", back_populates="registros")
