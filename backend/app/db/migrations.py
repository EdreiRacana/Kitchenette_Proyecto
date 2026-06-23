"""
Idempotent startup migrations — resilient.

Why this exists:
  `Base.metadata.create_all` only creates *missing tables*; it never alters a
  table that already exists. When we add columns to an existing model (e.g. the
  professional Customer fields, or the Sales `kind`/money breakdown), a live
  Postgres table needs ALTER statements.

  This runs those ALTERs automatically on every startup. Safe to repeat: every
  statement uses IF NOT EXISTS, so once applied each is a no-op.

Design choices for safety:
  - Postgres only. On SQLite (local dev) `create_all` builds the full table from
    the model and SQLite lacks `ADD COLUMN IF NOT EXISTS`, so we skip it.
  - Each statement runs in its OWN transaction, so one failing statement can't
    poison the rest (in Postgres an error aborts the whole surrounding tx).
  - Any error is logged, never raised. A migration hiccup must NOT take the API
    down — the server always boots.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

_CUSTOMER_STATEMENTS = [
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_number    VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_type      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS razon_social     VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc              VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS regimen_fiscal   VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS uso_cfdi         VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS cuenta_contable  VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS sucursal         VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list       VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_days      INTEGER DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_amount    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS discount_pact    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_number   VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_agent      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_agent     VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS how_heard        VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phones           TEXT",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS pais             VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS estado           VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS municipio        VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS localidad        VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS calle            VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS colonia          VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_postal    VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_exterior      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_interior      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_colonia   VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_localidad VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS referencia       TEXT",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes            TEXT",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT now()",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ",
    "UPDATE customers SET created_at = now() WHERE created_at IS NULL",
    "UPDATE customers SET client_number = 'CLI-' || lpad(id::text, 5, '0') WHERE client_number IS NULL",
    "UPDATE customers SET client_type = 'Contado' WHERE client_type IS NULL",
    "UPDATE customers SET pais = 'México' WHERE pais IS NULL",
    "UPDATE customers SET uso_cfdi = 'G03' WHERE uso_cfdi IS NULL",
    "UPDATE customers SET cuenta_contable = '105-01-001' WHERE cuenta_contable IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_client_number ON customers (client_number)",
    "CREATE INDEX IF NOT EXISTS ix_customers_client_type ON customers (client_type)",
    "CREATE INDEX IF NOT EXISTS ix_customers_sucursal    ON customers (sucursal)",
    "CREATE INDEX IF NOT EXISTS ix_customers_rfc         ON customers (rfc)",
]

_SALES_STATEMENTS = [
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS folio           VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id     INTEGER",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id         INTEGER",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind            VARCHAR DEFAULT 'order'",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse_id    INTEGER",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method  VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel         VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency        VARCHAR DEFAULT 'MXN'",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type   VARCHAR DEFAULT 'amount'",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_value  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount      DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount     DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS due_date        TIMESTAMPTZ",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS valid_until     TIMESTAMPTZ",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes           TEXT",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_rfc        VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_name       VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_use        VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_regime     VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_zip        VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_uuid       VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_status     VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoiced_at     TIMESTAMPTZ",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT now()",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ",
    "UPDATE orders SET kind = 'order' WHERE kind IS NULL",
    "UPDATE orders SET currency = 'MXN' WHERE currency IS NULL",
    "UPDATE orders SET discount_type = 'amount' WHERE discount_type IS NULL",
    "UPDATE orders SET folio = 'ORD-' || lpad(id::text, 6, '0') WHERE folio IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_orders_folio ON orders (folio)",
    "CREATE INDEX IF NOT EXISTS ix_orders_kind   ON orders (kind)",
    "CREATE INDEX IF NOT EXISTS ix_orders_status ON orders (status)",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name    VARCHAR",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku             VARCHAR",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_rate        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total           DOUBLE PRECISION DEFAULT 0",
    # Pre-existing schema had variant_id NOT NULL; the current model allows
    # free-text items (no catalog variant), so the DB constraint must relax too.
    "ALTER TABLE order_items ALTER COLUMN variant_id DROP NOT NULL",
]

# ── Ingesta Universal: tablas nuevas ────────────────────────────────────────
# Las tablas se crean via create_all en startup. Estas migraciones solo agregan
# columnas que pudieran faltar si la tabla ya existía de una versión anterior.
_INGESTA_STATEMENTS = [
    # ingesta_fuentes
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS nombre                VARCHAR",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS tipo_cliente          VARCHAR",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS tipo_ingesta          VARCHAR DEFAULT 'excel'",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS moneda                VARCHAR DEFAULT 'MXN'",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS periodicidad          VARCHAR DEFAULT 'flexible'",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS activa                BOOLEAN DEFAULT TRUE",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS notas                 TEXT",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS separador_decimal     VARCHAR DEFAULT 'punto'",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS formato_fecha         VARCHAR DEFAULT 'DD/MM/YYYY'",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS simbolo_moneda        VARCHAR DEFAULT 'ninguno'",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS fila_encabezado       INTEGER DEFAULT 1",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS tiene_filas_anidadas  BOOLEAN DEFAULT FALSE",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS campo_id_pedido       VARCHAR",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS patron_fila_total     VARCHAR",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ DEFAULT now()",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ",
    # ingesta_columnas
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS fuente_id         INTEGER",
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS columna_origen     VARCHAR",
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS campo_sthenova     VARCHAR",
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS muestra            VARCHAR",
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS confianza          DOUBLE PRECISION DEFAULT 1.0",
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS confirmada         BOOLEAN DEFAULT FALSE",
    # ingesta_reglas
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS fuente_id                    INTEGER",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS devolucion_fecha_venta       BOOLEAN DEFAULT TRUE",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS devolucion_acepta_huerfanas  BOOLEAN DEFAULT TRUE",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS devolucion_ventana_dias      INTEGER DEFAULT 90",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS inv_control_temporalidad     BOOLEAN DEFAULT TRUE",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS inv_alerta_amarilla_dias     INTEGER DEFAULT 90",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS inv_alerta_roja_dias         INTEGER DEFAULT 180",
    # ingesta_lotes
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS fuente_id       INTEGER",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS nombre_archivo  VARCHAR",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS tipo            VARCHAR DEFAULT 'excel'",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS estado          VARCHAR DEFAULT 'pendiente'",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS total_filas     INTEGER DEFAULT 0",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS filas_ok        INTEGER DEFAULT 0",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS filas_error     INTEGER DEFAULT 0",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS error_detalle   TEXT",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS periodo_inicio  VARCHAR",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS periodo_fin     VARCHAR",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT now()",
    "ALTER TABLE ingesta_lotes ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ",
    # ingesta_registros
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS lote_id              INTEGER",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS fuente_id            INTEGER",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS upc                  VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS sku_cliente          VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS sku_cadena           VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS descripcion          VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS fecha_inicio         VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS fecha_fin            VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS fecha_venta          VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS cantidad_vendida     DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS precio_unitario      DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS venta_bruta          DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS venta_neta           DOUBLE PRECISION",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS devoluciones_unidades DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS devoluciones_importe  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS sra                  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS bonificaciones       DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS descuentos           DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS cogs                 DOUBLE PRECISION",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS comisiones           DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS envio                DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS marketing            DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS inv_inicial          DOUBLE PRECISION",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS inv_final            DOUBLE PRECISION",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS entradas_resurtido   DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS moneda               VARCHAR DEFAULT 'MXN'",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS id_pedido_origen     VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS estatus_pedido       VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_estatus ON ingesta_registros (estatus_pedido)",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS datos_crudos         JSONB",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ DEFAULT now()",
    # índices útiles para consultas de BI
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_fuente  ON ingesta_registros (fuente_id)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_lote    ON ingesta_registros (lote_id)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_upc     ON ingesta_registros (upc)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_fechas  ON ingesta_registros (fecha_inicio, fecha_fin)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_lotes_fuente      ON ingesta_lotes (fuente_id)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_columnas_fuente   ON ingesta_columnas (fuente_id)",
    # v2 — campos nuevos
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS nombre_hoja           VARCHAR",
    "ALTER TABLE ingesta_columnas ADD COLUMN IF NOT EXISTS etiqueta_custom       VARCHAR",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS comision_origen         VARCHAR DEFAULT 'columna'",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS comision_porcentaje     DOUBLE PRECISION",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS precio_incluye_iva      BOOLEAN DEFAULT FALSE",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS iva_porcentaje          DOUBLE PRECISION DEFAULT 16.0",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS dev_columna_estatus     VARCHAR",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS dev_regla               VARCHAR DEFAULT 'contiene'",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS dev_valor               VARCHAR",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS dev_fecha_venta_original BOOLEAN DEFAULT TRUE",
    "ALTER TABLE ingesta_reglas ADD COLUMN IF NOT EXISTS dev_ventana_dias        INTEGER DEFAULT 90",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS variante             VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS subcategoria         VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS canal_venta          VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS metodo_envio         VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS fecha_entrega        VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS comision             DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS costo_logistico      DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS bonificaciones       DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS campo_extra_1        VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS campo_extra_2        VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS campo_extra_3        VARCHAR",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS es_devolucion        BOOLEAN DEFAULT FALSE",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_devolucion ON ingesta_registros (es_devolucion)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_estatus    ON ingesta_registros (estatus_pedido)",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_sku_cliente ON ingesta_registros (sku_cliente)",
]


def _apply(sync_conn: Connection) -> None:
    if sync_conn.dialect.name != "postgresql":
        return

    all_statements = [
        ("customers", _CUSTOMER_STATEMENTS),
        ("sales",     _SALES_STATEMENTS),
        ("ingesta",   _INGESTA_STATEMENTS),
    ]

    for label, statements in all_statements:
        applied, skipped = 0, 0
        for stmt in statements:
            try:
                with sync_conn.begin():
                    sync_conn.execute(text(stmt))
                applied += 1
            except Exception as e:
                skipped += 1
                print(f"[startup migrations] skipped: {stmt[:70]} -> {e}")
        print(f"[startup migrations] {label}: {applied} applied, {skipped} skipped")


async def run_startup_migrations(engine) -> None:
    """Run on its OWN connection, fully isolated from create_all, and never raise."""
    try:
        async with engine.connect() as conn:
            await conn.run_sync(_apply)
    except Exception as e:
        print(f"[startup migrations] disabled (connection error): {e}")
