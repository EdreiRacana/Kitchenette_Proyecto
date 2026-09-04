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
    # Origen del cliente: b2b (empresa con RFC) | pos (particular walk-in)
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS source           VARCHAR DEFAULT 'b2b' NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_customers_source ON customers(source)",
    # Backfill: si no tiene RFC ni razón social, es probable un cliente POS
    "UPDATE customers SET source = 'pos' WHERE source = 'b2b' AND (rfc IS NULL OR rfc = '') AND (razon_social IS NULL OR razon_social = '')",
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
    # ── Universal ERP (perfil comercial extendido) ──────────
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS relationship_type       VARCHAR DEFAULT 'retail'",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS commission_base_pct     DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS logistics_pct           DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS logistics_fixed         DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS cedis_pct               DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_pct              DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS withholding_scheme      VARCHAR DEFAULT 'none'",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS withholding_isr_pct     DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS withholding_iva_pct     DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS commercial_discount_pct DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketplace_platform    VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS seller_id_external      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consignment_settlement_days INTEGER DEFAULT 30",
    # Retail Dashboard v3: logo del cliente (para mostrar en el header del módulo)
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS logo_base64 TEXT",
    "UPDATE customers SET relationship_type = 'retail' WHERE relationship_type IS NULL",
    "UPDATE customers SET withholding_scheme = 'none' WHERE withholding_scheme IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_customers_relationship_type ON customers (relationship_type)",
]

_UNIVERSAL_ERP_STATEMENTS = [
    # Orders: campos nuevos para marketplace / consignación / servicios / POS
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS relationship_type   VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_order_id   VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS import_id           INTEGER",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_session_id      INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_orders_pos_session_id ON orders (pos_session_id)",
    "CREATE INDEX IF NOT EXISTS ix_orders_external_order_id ON orders (external_order_id)",
    "CREATE INDEX IF NOT EXISTS ix_orders_relationship_type ON orders (relationship_type)",
    # OrderItem: is_service + unit_cost snapshot para P&L
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_service BOOLEAN DEFAULT FALSE",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost  DOUBLE PRECISION DEFAULT 0",
    # CompanyProfile: branding + business_mode
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS commercial_name  VARCHAR",
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS brand_color      VARCHAR DEFAULT '#33B2F5'",
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS document_footer  TEXT",
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS business_mode    VARCHAR DEFAULT 'product'",
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
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_serie      VARCHAR(32)",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_folio      VARCHAR(32)",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_xml        BYTEA",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_pdf        BYTEA",
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
    # v3 — puente Ingesta → Ventas (Excel/CSV/API ya no son data huérfana de BI)
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS customer_id       INTEGER",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS api_key           VARCHAR",
    "ALTER TABLE ingesta_fuentes ADD COLUMN IF NOT EXISTS auto_crear_ventas BOOLEAN DEFAULT FALSE",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_ingesta_fuentes_api_key ON ingesta_fuentes (api_key)",
    "ALTER TABLE ingesta_registros ADD COLUMN IF NOT EXISTS order_id          INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_ingesta_registros_order ON ingesta_registros (order_id)",
]


_INVENTORY_STATEMENTS = [
    "ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS type VARCHAR DEFAULT 'own'",
    "UPDATE warehouses SET type = 'own' WHERE type IS NULL",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_manufactured BOOLEAN DEFAULT false",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS item_type VARCHAR DEFAULT 'finished_good'",
    "UPDATE products SET item_type = 'finished_good' WHERE item_type IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_products_item_type ON products (item_type)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS commercial_terms TEXT",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS extra_contacts JSONB",
    # DIOT (SAT A29) - clasificacion del proveedor para la declaracion
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS diot_third_type VARCHAR DEFAULT '04'",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS diot_operation_type VARCHAR DEFAULT '85'",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country_code VARCHAR",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS foreign_tax_id VARCHAR",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS foreign_nationality VARCHAR",
    "UPDATE suppliers SET diot_third_type = '04' WHERE diot_third_type IS NULL",
    "UPDATE suppliers SET diot_operation_type = '85' WHERE diot_operation_type IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_supplier_documents_supplier ON supplier_documents (supplier_id)",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_product_variants_barcode ON product_variants (barcode)",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reorder_point INTEGER",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS safety_stock INTEGER",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS lead_time_days INTEGER",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS preferred_supplier_id INTEGER",
    # Never Be Out flag (must-have SKU) — Retail v2 world-class
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_must_have BOOLEAN DEFAULT false",
    "UPDATE product_variants SET is_must_have = false WHERE is_must_have IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_product_variants_must_have ON product_variants (is_must_have) WHERE is_must_have = true",
    "ALTER TABLE stock_levels ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER DEFAULT 0",
    "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION",
    # ── Trazabilidad por lote + caducidad (perecederos) ──────────────────
    # Producto: flag y política de vida útil / alertas
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS tracks_batches BOOLEAN DEFAULT false NOT NULL",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_shelf_life_days INTEGER",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_alert_days INTEGER DEFAULT 30",
    "CREATE INDEX IF NOT EXISTS ix_products_tracks_batches ON products (tracks_batches) WHERE tracks_batches = true",
    # Lote: código, caducidad, fabricación, proveedor y estado
    "ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS batch_code VARCHAR",
    "ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS expiration_date DATE",
    "ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS manufacturing_date DATE",
    "ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)",
    "ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'active' NOT NULL",
    "UPDATE stock_lots SET status = 'active' WHERE status IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_stock_lots_batch_code ON stock_lots (batch_code) WHERE batch_code IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_stock_lots_expiration ON stock_lots (expiration_date) WHERE expiration_date IS NOT NULL AND status = 'active'",
    "CREATE INDEX IF NOT EXISTS ix_stock_lots_status ON stock_lots (status)",
    "CREATE INDEX IF NOT EXISTS ix_stock_lots_variant_wh_exp ON stock_lots (variant_id, warehouse_id, expiration_date)",
    # Movimiento: referencia al lote consumido/generado (para recall + kardex)
    "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS stock_lot_id INTEGER REFERENCES stock_lots(id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_movements_lot ON stock_movements (stock_lot_id) WHERE stock_lot_id IS NOT NULL",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_amount  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS due_date     TIMESTAMPTZ",
    "UPDATE purchase_orders SET total_amount = 0 WHERE total_amount IS NULL",
    "UPDATE purchase_orders SET paid_amount = 0 WHERE paid_amount IS NULL",
    "UPDATE stock_movements SET movement_type = lower(movement_type) WHERE movement_type <> lower(movement_type)",
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS extra_costs JSONB",
    # Traspasos entre almacenes (Stock Transfer Orders)
    """CREATE TABLE IF NOT EXISTS stock_transfers (
        id                          SERIAL PRIMARY KEY,
        folio                       VARCHAR UNIQUE,
        source_warehouse_id         INTEGER NOT NULL REFERENCES warehouses(id),
        destination_warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
        status                      VARCHAR NOT NULL DEFAULT 'draft',
        notes                       TEXT,
        expected_delivery_date      TIMESTAMP WITH TIME ZONE,
        created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by_id               INTEGER REFERENCES users(id),
        approved_at                 TIMESTAMP WITH TIME ZONE,
        approved_by_id              INTEGER REFERENCES users(id),
        shipped_at                  TIMESTAMP WITH TIME ZONE,
        shipped_by_id               INTEGER REFERENCES users(id),
        received_at                 TIMESTAMP WITH TIME ZONE,
        received_by_id              INTEGER REFERENCES users(id),
        cancelled_at                TIMESTAMP WITH TIME ZONE,
        cancelled_by_id             INTEGER REFERENCES users(id),
        cancelled_reason            TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS ix_transfers_folio  ON stock_transfers (folio)",
    "CREATE INDEX IF NOT EXISTS ix_transfers_source ON stock_transfers (source_warehouse_id)",
    "CREATE INDEX IF NOT EXISTS ix_transfers_dest   ON stock_transfers (destination_warehouse_id)",
    "CREATE INDEX IF NOT EXISTS ix_transfers_status ON stock_transfers (status, created_at DESC)",
    """CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id                          SERIAL PRIMARY KEY,
        transfer_id                 INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
        variant_id                  INTEGER NOT NULL REFERENCES product_variants(id),
        quantity_requested          INTEGER NOT NULL DEFAULT 0,
        quantity_shipped            INTEGER NOT NULL DEFAULT 0,
        quantity_received           INTEGER NOT NULL DEFAULT 0,
        unit_cost_snapshot          DOUBLE PRECISION NOT NULL DEFAULT 0,
        discrepancy_reason          TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS ix_transfer_items_transfer ON stock_transfer_items (transfer_id)",
    # Rellena recetas históricas: mismo patrón que en purchase_orders. Sin
    # este UPDATE, /inventory/recipes truena en Pydantic si existen
    # recetas creadas antes de que se agregara la columna extra_costs.
    "UPDATE recipes SET extra_costs = '[]'::jsonb WHERE extra_costs IS NULL",
    # Landed cost en compras: extras (flete, aduana, seguros, IVA no
    # acreditable, etc.) que se prorratean entre las partidas al recibir.
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS extra_costs JSONB",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS landed_cost_allocation VARCHAR DEFAULT 'by_value'",
    "UPDATE purchase_orders SET landed_cost_allocation = 'by_value' WHERE landed_cost_allocation IS NULL",
    # Rellena OCs históricas: sin este UPDATE, extra_costs queda NULL en las
    # filas viejas y la respuesta de /inventory/purchase-orders truena en
    # Pydantic (List esperada, None recibido). El validator del schema es la
    # segunda barrera; este UPDATE normaliza el dato en la fuente.
    "UPDATE purchase_orders SET extra_costs = '[]'::jsonb WHERE extra_costs IS NULL",
    # Snapshot del costo integrado por partida (con extras prorrateados). Se
    # llena al recibir la OC; se preserva `unit_cost` (factura) para trazabilidad.
    "ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS landed_unit_cost DOUBLE PRECISION",
]

_FINANCE_STATEMENTS = [
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_by_id INTEGER",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS attachment_url TEXT",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reconciled BOOLEAN DEFAULT FALSE",
    "ALTER TABLE scheduled_payments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ",
    "ALTER TABLE scheduled_payments ADD COLUMN IF NOT EXISTS bank_account_id INTEGER",
]

_HR_STATEMENTS = [
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS infonavit_discount_type  VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS infonavit_discount_value DOUBLE PRECISION",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS fonacot_discount_value   DOUBLE PRECISION",
    "ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS hours DOUBLE PRECISION",
    # Calidad de cálculo: tipo de nómina + nuevas percepciones/deducciones + patronal
    "ALTER TABLE hr_payroll_periods ADD COLUMN IF NOT EXISTS kind VARCHAR DEFAULT 'regular'",
    "UPDATE hr_payroll_periods SET kind = 'regular' WHERE kind IS NULL",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS days_absent        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS days_incapacity    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS aguinaldo          DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS subsidy_applied    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS imss_employer      DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS infonavit_employer DOUBLE PRECISION DEFAULT 0",
    # ISN patronal + edición manual de la partida de nómina
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS state_payroll_tax  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS notes              TEXT",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS edited_manually    BOOLEAN DEFAULT FALSE",
    "UPDATE hr_payroll_details SET edited_manually = FALSE WHERE edited_manually IS NULL",
    # Fase 4 — pensión alimenticia, incapacidades tipificadas
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS alimony_type         VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS alimony_value        DOUBLE PRECISION",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS alimony_beneficiary  VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS alimony_court_order  VARCHAR",
    "ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS incapacity_subtype  VARCHAR",
    "ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS imss_folio          VARCHAR",
    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS alimony          DOUBLE PRECISION DEFAULT 0",
    # Datos personales del empleado exigidos por LFT art. 25 para contratos
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS nationality   VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS birth_date    VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS gender        VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS marital_status VARCHAR",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS address       TEXT",
    # Campos extra de la ficha del contrato (LFT art. 25)
    "ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS rest_days       VARCHAR",
    "ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS payment_method  VARCHAR",
    "ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS payment_place   TEXT",
    "ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS training_clause TEXT",
    "ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS temporary_reason TEXT",
    # PTU (art. 127 LFT) — marca empleados excluidos del reparto:
    # directores, administradores, gerentes generales (frac. I).
    # is_confidential: si es trabajador de confianza (aplica cap art. 127-II).
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS ptu_excluded BOOLEAN DEFAULT FALSE",
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN DEFAULT FALSE",
    "UPDATE hr_employees SET ptu_excluded = FALSE WHERE ptu_excluded IS NULL",
    "UPDATE hr_employees SET is_confidential = FALSE WHERE is_confidential IS NULL",
    # Ajuste anual ISR (art. 97-B LISR) — aviso escrito del empleado de que
    # hará su propia declaración anual, releva al patrón del ajuste.
    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS declares_own_annual BOOLEAN DEFAULT FALSE",
    "UPDATE hr_employees SET declares_own_annual = FALSE WHERE declares_own_annual IS NULL",
]

_AUTH_STATEMENTS = [
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS color VARCHAR",
    "UPDATE roles SET is_system = FALSE WHERE is_system IS NULL",
    # Foto de perfil del usuario (data URI); si NULL, /auth/me la resuelve
    # cayendo al Employee con el mismo email.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes VARCHAR",
    "UPDATE users SET two_factor_enabled = FALSE WHERE two_factor_enabled IS NULL",
]

_BRANCH_STATEMENTS = [
    "ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    # Conciliación bancaria — Transaction ligada a la cuenta bancaria destino/origen
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_bank_account_id ON transactions (bank_account_id)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE budgets ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    # Tasa ISN estatal (patronal) en el perfil de la empresa
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS state_payroll_tax_rate DOUBLE PRECISION DEFAULT 3.0",
    # Logo persistente en la DB (el filesystem de Render es efímero)
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS logo_bytes BYTEA",
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS logo_mime  VARCHAR",
    # Multi-empresa (multi-tenant real) — company_profile deja de ser singleton
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS regimen_fiscal VARCHAR",
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "UPDATE company_profile SET is_active = TRUE WHERE is_active IS NULL",
    # Registro patronal IMSS — para avisos AFIL-02/04/08 y cédulas
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS imss_registro_patronal VARCHAR",
    # Correo de contabilidad — destino por defecto de reportes automáticos
    # (cierre de turno POS, cortes, etc.)
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS accounting_email VARCHAR",
    # Correos operativos separados por coma — reciben alertas de perecederos
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS alerts_recipients VARCHAR",
    # Cierre de período contable
    """CREATE TABLE IF NOT EXISTS accounting_period_close (
        id            SERIAL PRIMARY KEY,
        year          INTEGER NOT NULL,
        month         INTEGER NOT NULL,
        status        VARCHAR NOT NULL DEFAULT 'closed',
        closed_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        reopened_at   TIMESTAMP WITH TIME ZONE,
        closed_by_id  INTEGER REFERENCES users(id),
        reopened_by_id INTEGER REFERENCES users(id),
        snapshot_json TEXT,
        notes         TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS ix_period_close_year_month ON accounting_period_close (year, month)",
    # Políticas contables (versionadas por effective_from) — permiten al
    # contador escoger el flujo que mejor le acomode a la empresa: base flujo
    # vs devengado, perpetuo vs analítico, nómina consolidada vs desglosada,
    # retenciones automáticas, tipo de cambio, provisiones y depreciación.
    """CREATE TABLE IF NOT EXISTS accounting_policies (
        id                        SERIAL PRIMARY KEY,
        branch_id                 INTEGER REFERENCES branches(id),
        iva_acreditable_scheme    VARCHAR NOT NULL DEFAULT 'pending_payment',
        iva_trasladado_scheme     VARCHAR NOT NULL DEFAULT 'pending_collection',
        cogs_scheme               VARCHAR NOT NULL DEFAULT 'perpetual',
        purchase_recognition      VARCHAR NOT NULL DEFAULT 'on_receive',
        payroll_scheme            VARCHAR NOT NULL DEFAULT 'itemized',
        expense_basis             VARCHAR NOT NULL DEFAULT 'accrual',
        withholding_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        withholding_rates         JSONB,
        fx_scheme                 VARCHAR NOT NULL DEFAULT 'transaction_date',
        labor_benefits_scheme     VARCHAR NOT NULL DEFAULT 'monthly_provision',
        depreciation_scheme       VARCHAR NOT NULL DEFAULT 'straight_line_monthly',
        effective_from            TIMESTAMP WITH TIME ZONE NOT NULL,
        status                    VARCHAR NOT NULL DEFAULT 'active',
        superseded_at             TIMESTAMP WITH TIME ZONE,
        superseded_by_id          INTEGER REFERENCES accounting_policies(id),
        notes                     TEXT,
        created_by_id             INTEGER REFERENCES users(id),
        created_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS ix_accounting_policies_effective ON accounting_policies (effective_from DESC)",
    "CREATE INDEX IF NOT EXISTS ix_accounting_policies_status    ON accounting_policies (status)",
    "CREATE INDEX IF NOT EXISTS ix_accounting_policies_branch    ON accounting_policies (branch_id)",
    # Activos fijos depreciables (Hook 9)
    """CREATE TABLE IF NOT EXISTS accounting_fixed_assets (
        id                             SERIAL PRIMARY KEY,
        name                           VARCHAR NOT NULL,
        category                       VARCHAR,
        acquisition_date               TIMESTAMP WITH TIME ZONE NOT NULL,
        acquisition_cost               DOUBLE PRECISION NOT NULL,
        salvage_value                  DOUBLE PRECISION NOT NULL DEFAULT 0,
        annual_rate_pct                DOUBLE PRECISION NOT NULL,
        useful_life_months             INTEGER NOT NULL,
        asset_account_id               INTEGER REFERENCES accounting_accounts(id),
        accumulated_depr_account_id    INTEGER REFERENCES accounting_accounts(id),
        expense_account_id             INTEGER REFERENCES accounting_accounts(id),
        is_active                      BOOLEAN NOT NULL DEFAULT TRUE,
        disposed_at                    TIMESTAMP WITH TIME ZONE,
        accumulated_depreciation       DOUBLE PRECISION NOT NULL DEFAULT 0,
        branch_id                      INTEGER REFERENCES branches(id),
        notes                          TEXT,
        created_by_id                  INTEGER REFERENCES users(id),
        created_at                     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS ix_fixed_assets_active ON accounting_fixed_assets (is_active, acquisition_date)",
    "CREATE INDEX IF NOT EXISTS ix_fixed_assets_branch ON accounting_fixed_assets (branch_id)",
    # Multi-currency en OC (Hook 8)
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'MXN'",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS fx_rate  DOUBLE PRECISION DEFAULT 1.0",
    "UPDATE purchase_orders SET currency = 'MXN' WHERE currency IS NULL",
    "UPDATE purchase_orders SET fx_rate = 1.0 WHERE fx_rate IS NULL",
    # Conciliación bancaria
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_date TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS matched_transaction_id INTEGER REFERENCES transactions(id)",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual'",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS external_ref VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_bank_tx_ext_ref ON bank_transactions (bank_account_id, external_ref)",
]


_LOYALTY_STATEMENTS = [
    # Programa de fidelización — CRM al servicio del negocio. Cada empresa
    # configura sus propios tiers, umbrales y porcentajes. Los defaults
    # están DESACTIVADOS (is_enabled=false) para que nada aplique hasta
    # que la empresa entre a Configuración y lo prenda.
    """CREATE TABLE IF NOT EXISTS customer_tiers (
        id             SERIAL PRIMARY KEY,
        name           VARCHAR NOT NULL,
        color_hex      VARCHAR,
        rank           INTEGER NOT NULL DEFAULT 0,
        discount_pct   DOUBLE PRECISION NOT NULL DEFAULT 0,
        min_spend      DOUBLE PRECISION NOT NULL DEFAULT 0,
        min_orders     INTEGER NOT NULL DEFAULT 0,
        min_avg_ticket DOUBLE PRECISION NOT NULL DEFAULT 0,
        perks          TEXT,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS ix_customer_tiers_active ON customer_tiers (is_active, rank)",
    """CREATE TABLE IF NOT EXISTS loyalty_program_config (
        id                       SERIAL PRIMARY KEY,
        is_enabled               BOOLEAN NOT NULL DEFAULT FALSE,
        program_name             VARCHAR NOT NULL DEFAULT 'Programa de Fidelidad',
        tagline                  VARCHAR,
        tier_lookback_months     INTEGER DEFAULT 12,
        card_validity_days       INTEGER NOT NULL DEFAULT 365,
        recalc_on_each_sale      BOOLEAN NOT NULL DEFAULT TRUE,
        card_bg_color            VARCHAR NOT NULL DEFAULT '#0F172A',
        card_text_color          VARCHAR NOT NULL DEFAULT '#FFFFFF',
        card_accent_color        VARCHAR NOT NULL DEFAULT '#33B2F5',
        privacy_policy_url       VARCHAR,
        privacy_policy_text      TEXT,
        birthday_email_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
        birthday_email_subject   VARCHAR NOT NULL DEFAULT '¡Feliz cumpleaños!',
        birthday_email_body      TEXT,
        updated_at               TIMESTAMP WITH TIME ZONE
    )""",
    # Semilla del singleton (id=1) si aún no existe
    "INSERT INTO loyalty_program_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    # Semilla de tiers default (desactivados hasta que la empresa los ajuste)
    """INSERT INTO customer_tiers (name, color_hex, rank, discount_pct, min_spend, min_orders, perks, is_active)
       SELECT * FROM (VALUES
         ('Bronce',   '#CD7F32', 1,  3.0,   5000.0,  3, 'Descuento de bienvenida', FALSE),
         ('Plata',    '#C0C0C0', 2,  5.0,  20000.0, 10, 'Envío gratis en pedidos grandes', FALSE),
         ('Oro',      '#D4AF37', 3,  8.0,  50000.0, 20, 'Regalo de cumpleaños', FALSE),
         ('Diamante', '#B9F2FF', 4, 12.0, 100000.0, 40, 'Atención VIP y eventos exclusivos', FALSE)
       ) AS v(name, color_hex, rank, discount_pct, min_spend, min_orders, perks, is_active)
       WHERE NOT EXISTS (SELECT 1 FROM customer_tiers)""",
    # Extender customers con los campos de fidelización
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth        TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS sex                  VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS accepts_marketing    BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS privacy_accepted_at  TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier_id              INTEGER REFERENCES customer_tiers(id)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_code         VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_since        TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_expires_at   TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spent_lifetime  DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders_lifetime INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at        TIMESTAMP WITH TIME ZONE",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_loyalty_code ON customers (loyalty_code) WHERE loyalty_code IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_customers_tier_id ON customers (tier_id)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS manual_tier BOOLEAN NOT NULL DEFAULT FALSE",
]


_PROMOTIONS_STATEMENTS = [
    # Planificador de promociones (reemplaza el Excel manual de traspasos previos
    # a una campaña). Un PromotionPlan agrupa varias variantes que van en promo,
    # aplicadas a varios almacenes destino (tiendas), con un uplift esperado.
    # El motor de sugerencias corre bajo demanda y genera PromotionSuggestion.
    """CREATE TABLE IF NOT EXISTS promotion_plans (
        id                      SERIAL PRIMARY KEY,
        folio                   VARCHAR UNIQUE,
        name                    VARCHAR NOT NULL,
        description             TEXT,
        start_date              TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date                TIMESTAMP WITH TIME ZONE NOT NULL,
        expected_uplift_pct     DOUBLE PRECISION NOT NULL DEFAULT 50.0,
        baseline_lookback_days  INTEGER NOT NULL DEFAULT 30,
        lead_time_days          INTEGER NOT NULL DEFAULT 5,
        status                  VARCHAR NOT NULL DEFAULT 'planned',
        notes                   TEXT,
        created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by_id           INTEGER REFERENCES users(id),
        updated_at              TIMESTAMP WITH TIME ZONE
    )""",
    "CREATE INDEX IF NOT EXISTS ix_promotion_plans_folio  ON promotion_plans (folio)",
    "CREATE INDEX IF NOT EXISTS ix_promotion_plans_status ON promotion_plans (status, start_date DESC)",
    "CREATE INDEX IF NOT EXISTS ix_promotion_plans_dates  ON promotion_plans (start_date, end_date)",
    """CREATE TABLE IF NOT EXISTS promotion_plan_items (
        id           SERIAL PRIMARY KEY,
        promotion_id INTEGER NOT NULL REFERENCES promotion_plans(id) ON DELETE CASCADE,
        variant_id   INTEGER NOT NULL REFERENCES product_variants(id),
        promo_price  DOUBLE PRECISION,
        discount_pct DOUBLE PRECISION
    )""",
    "CREATE INDEX IF NOT EXISTS ix_promotion_items_promo ON promotion_plan_items (promotion_id)",
    """CREATE TABLE IF NOT EXISTS promotion_target_stores (
        id           SERIAL PRIMARY KEY,
        promotion_id INTEGER NOT NULL REFERENCES promotion_plans(id) ON DELETE CASCADE,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_promotion_stores_promo ON promotion_target_stores (promotion_id)",
    """CREATE TABLE IF NOT EXISTS promotion_suggestions (
        id                          SERIAL PRIMARY KEY,
        promotion_id                INTEGER NOT NULL REFERENCES promotion_plans(id) ON DELETE CASCADE,
        variant_id                  INTEGER NOT NULL REFERENCES product_variants(id),
        source_warehouse_id         INTEGER REFERENCES warehouses(id),
        destination_warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
        baseline_daily_velocity     DOUBLE PRECISION NOT NULL DEFAULT 0,
        expected_units_during_promo DOUBLE PRECISION NOT NULL DEFAULT 0,
        current_stock               INTEGER NOT NULL DEFAULT 0,
        quantity_suggested          INTEGER NOT NULL DEFAULT 0,
        shortage_flag               VARCHAR,
        note                        TEXT,
        transfer_id                 INTEGER REFERENCES stock_transfers(id),
        computed_at                 TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS ix_promo_suggestions_promo ON promotion_suggestions (promotion_id)",
    "CREATE INDEX IF NOT EXISTS ix_promo_suggestions_transfer ON promotion_suggestions (transfer_id)",
]


_RETAIL_STATEMENTS = [
    # Config de alertas por cadena (agregada tras la Fase 3)
    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS no_movement_days     INTEGER DEFAULT 21 NOT NULL",
    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS sell_through_min_pct DOUBLE PRECISION DEFAULT 20.0 NOT NULL",
    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS alerts_enabled       BOOLEAN DEFAULT TRUE NOT NULL",
    # Consignación (Fase 4)
    "ALTER TABLE retail_stores          ADD COLUMN IF NOT EXISTS consignment_warehouse_id INTEGER REFERENCES warehouses(id)",
    # Agenda de demostradora / promotora por tienda (Fase perecederos)
    "ALTER TABLE retail_stores          ADD COLUMN IF NOT EXISTS demonstrator_name  VARCHAR",
    "ALTER TABLE retail_stores          ADD COLUMN IF NOT EXISTS demonstrator_phone VARCHAR",
    "ALTER TABLE retail_stores          ADD COLUMN IF NOT EXISTS demonstrator_email VARCHAR",
    "ALTER TABLE retail_sellout_reports ADD COLUMN IF NOT EXISTS stock_consumed           INTEGER DEFAULT 0 NOT NULL",
    # Perfiles de importación por cadena (Fase 7)
    """CREATE TABLE IF NOT EXISTS retail_import_profiles (
        id                    SERIAL PRIMARY KEY,
        channel_id            INTEGER NOT NULL REFERENCES retail_channels(id) ON DELETE CASCADE,
        name                  VARCHAR NOT NULL,
        notes                 TEXT,
        is_active             BOOLEAN DEFAULT TRUE NOT NULL,
        is_default            BOOLEAN DEFAULT FALSE NOT NULL,
        file_format           VARCHAR DEFAULT 'xlsx' NOT NULL,
        sheet_name            VARCHAR,
        header_row            INTEGER DEFAULT 1 NOT NULL,
        encoding              VARCHAR DEFAULT 'utf-8' NOT NULL,
        delimiter             VARCHAR DEFAULT ',' NOT NULL,
        date_format           VARCHAR DEFAULT 'auto' NOT NULL,
        decimal_separator     VARCHAR DEFAULT '.' NOT NULL,
        thousands_separator   VARCHAR DEFAULT '' NOT NULL,
        units_multiplier      DOUBLE PRECISION DEFAULT 1.0 NOT NULL,
        revenue_multiplier    DOUBLE PRECISION DEFAULT 1.0 NOT NULL,
        default_period_type   VARCHAR DEFAULT 'week' NOT NULL,
        column_map            JSONB DEFAULT '{}'::jsonb NOT NULL,
        ignore_row_pattern    VARCHAR,
        default_channel_code  VARCHAR,
        created_at            TIMESTAMPTZ DEFAULT now(),
        updated_at            TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS ix_retail_import_profiles_channel_id ON retail_import_profiles(channel_id)",
    # Devoluciones (Fase 8) — captura los returns que las cadenas reportan
    # junto con el sell-out para no perderlos, calcular tasa y alertar.
    "ALTER TABLE retail_channels          ADD COLUMN IF NOT EXISTS return_rate_max_pct DOUBLE PRECISION DEFAULT 5.0 NOT NULL",
    # Modelo comercial de la cadena — firme / consignacion / marketplace
    "ALTER TABLE retail_channels          ADD COLUMN IF NOT EXISTS sale_type VARCHAR DEFAULT 'consignacion' NOT NULL",
    "UPDATE retail_channels               SET sale_type = 'consignacion' WHERE sale_type IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_retail_channels_sale_type ON retail_channels(sale_type)",
    "ALTER TABLE retail_sellout_reports   ADD COLUMN IF NOT EXISTS units_returned      INTEGER DEFAULT 0 NOT NULL",
    "ALTER TABLE retail_sellout_reports   ADD COLUMN IF NOT EXISTS returns_amount      DOUBLE PRECISION DEFAULT 0.0 NOT NULL",
    # Promociones (Fase 9) — ventana + alcance + mecánica para medir el lift.
    """CREATE TABLE IF NOT EXISTS retail_promotions (
        id             SERIAL PRIMARY KEY,
        channel_id     INTEGER NOT NULL REFERENCES retail_channels(id) ON DELETE CASCADE,
        store_id       INTEGER REFERENCES retail_stores(id) ON DELETE SET NULL,
        variant_id     INTEGER REFERENCES product_variants(id),
        product_name   VARCHAR,
        sku            VARCHAR,
        name           VARCHAR NOT NULL,
        mechanic       VARCHAR DEFAULT 'descuento' NOT NULL,
        discount_pct   DOUBLE PRECISION,
        promo_price    DOUBLE PRECISION,
        start_date     TIMESTAMPTZ NOT NULL,
        end_date       TIMESTAMPTZ NOT NULL,
        baseline_weeks INTEGER DEFAULT 4 NOT NULL,
        is_active      BOOLEAN DEFAULT TRUE NOT NULL,
        notes          TEXT,
        created_at     TIMESTAMPTZ DEFAULT now(),
        updated_at     TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS ix_retail_promotions_channel ON retail_promotions(channel_id)",
    "CREATE INDEX IF NOT EXISTS ix_retail_promotions_dates ON retail_promotions(start_date, end_date)",
]


_SALES_AGENTS_STATEMENTS = [
    # La tabla sales_agents la crea create_all; aquí solo la columna de
    # atribución en orders (una tabla existente que create_all nunca altera).
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_agent_id INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_orders_sales_agent_id ON orders(sales_agent_id)",
    # Costo real de la paquetería (separado del envío cobrado al cliente).
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost DOUBLE PRECISION DEFAULT 0",
    # Saldos negativos históricos en ventas POS: el efectivo recibido (con
    # cambio) se guardaba como pagado, dejando saldo = total − recibido < 0.
    # El cambio no es sobrepago; la venta se liquida exactamente por su total.
    "UPDATE orders SET paid_amount = total_amount "
    "WHERE channel = 'pos' AND paid_amount > total_amount + 0.005",
]


# ── Asistente conversacional — tracking de gasto LLM ─────────────────
_ASSISTANT_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS assistant_llm_usage (
        id             SERIAL PRIMARY KEY,
        created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        user_id        INTEGER,
        purpose        VARCHAR NOT NULL,
        model          VARCHAR NOT NULL,
        input_tokens   INTEGER DEFAULT 0 NOT NULL,
        output_tokens  INTEGER DEFAULT 0 NOT NULL,
        cost_usd       DOUBLE PRECISION DEFAULT 0 NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS ix_assistant_usage_created ON assistant_llm_usage (created_at)",
    # Fase 14 — loop de aprendizaje: preguntas que NO matchearon el
    # router determinista. Se revisa periodicamente para crear patrones
    # nuevos. matched_by: 'llm' si Haiku resolvió, 'none' si tampoco.
    """CREATE TABLE IF NOT EXISTS assistant_unmatched_queries (
        id           SERIAL PRIMARY KEY,
        created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        user_id      INTEGER,
        question     TEXT NOT NULL,
        matched_by   VARCHAR NOT NULL DEFAULT 'none',
        tool_hit     VARCHAR
    )""",
    "CREATE INDEX IF NOT EXISTS ix_assistant_unmatched_created ON assistant_unmatched_queries (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_assistant_unmatched_matched_by ON assistant_unmatched_queries (matched_by)",
]


# ── Multi-marca: campos nuevos en company_profile (Fase 1a) ──────────
# Extienden el modelo existente sin romper nada. Todo con IF NOT EXISTS
# para poder correr múltiples veces sin efecto.
_BRAND_FIELDS_STATEMENTS = [
    # business_model: 'direct' (empresa factura y cobra) | 'agency' (matriz
    # extranjera factura y cobra; la empresa MX solo gestiona y cobra
    # comisión). Cosméticos = direct; Apple / Cocina = agency.
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS business_model VARCHAR DEFAULT 'direct' NOT NULL",
    # % de comisión default cuando business_model='agency'. 0 si no aplica.
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS commission_default_pct DOUBLE PRECISION DEFAULT 0.0 NOT NULL",
    # Base de cálculo de la comisión: 'gross' (total) | 'subtotal' (sin IVA)
    # | 'net' (después de descuentos de marketing). Default: net.
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS commission_base VARCHAR DEFAULT 'net' NOT NULL",
    # Marca de demo/showcase — no cuenta en reportes corporativos
    # consolidados, se resetea/duplica desde admin. Ideal para presentar
    # el ERP a prospectos sin exponer datos reales de clientes.
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE NOT NULL",
]


# ── Fase 1b · Multi-tenancy: company_id en tablas transaccionales ────
# Cada ALTER agrega company_id nullable + índice. Después, un bulk
# UPDATE asigna todo lo existente al primer CompanyProfile — que en
# nuestra migración inicial es Elías Jabari (single-tenant original).
# 100% idempotente. Puede correr múltiples veces.
_TENANCY_STATEMENTS = [
    # 1. Agregar columna company_id + FK + índice a las 11 tablas core.
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_orders_company_id ON orders(company_id)",

    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_customers_company_id ON customers(company_id)",

    "ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_products_company_id ON products(company_id)",

    "ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_warehouses_company_id ON warehouses(company_id)",

    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_suppliers_company_id ON suppliers(company_id)",

    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_purchase_orders_company_id ON purchase_orders(company_id)",

    "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_hr_employees_company_id ON hr_employees(company_id)",

    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_bank_accounts_company_id ON bank_accounts(company_id)",

    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_company_id ON transactions(company_id)",

    "ALTER TABLE supplier_bills ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_supplier_bills_company_id ON supplier_bills(company_id)",

    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_retail_channels_company_id ON retail_channels(company_id)",

    # 2. Bulk update: asignar todo lo existente sin company_id al PRIMER
    # CompanyProfile (por created_at asc — típicamente Elías Jabari, la
    # empresa inicial). Solo actualiza filas donde company_id IS NULL,
    # así al re-correr no pisa marcas ya asignadas.
    """UPDATE orders SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE customers SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE products SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE warehouses SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE suppliers SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE purchase_orders SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE hr_employees SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE bank_accounts SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE transactions SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE supplier_bills SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    """UPDATE retail_channels SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",

    # ── POS terminals (multi-tenancy) ────────────────────────────────
    # Las cajas registradas en Elias Jabari se veian en otras empresas
    # porque pos_terminals no tenia company_id. Backfill al tenant original.
    "ALTER TABLE pos_terminals ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_pos_terminals_company_id ON pos_terminals(company_id)",
    """UPDATE pos_terminals SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",

    # ── POS sessions y transactions: backfill company_id via terminal ──
    # POSSession y POSTransaction ya tenian columna company_id (definida
    # en el modelo), pero registros creados antes del deploy del PR 259
    # quedaron con NULL — el hook auto-tenancy no los devolvia, causando
    # "sesion no abierta" y 500 al cobrar. Backfill via join al terminal.
    "CREATE INDEX IF NOT EXISTS ix_pos_sessions_company_id ON pos_sessions(company_id)",
    """UPDATE pos_sessions s SET company_id = t.company_id
        FROM pos_terminals t
        WHERE s.terminal_id = t.id AND s.company_id IS NULL AND t.company_id IS NOT NULL""",
    """UPDATE pos_sessions SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
    "CREATE INDEX IF NOT EXISTS ix_pos_transactions_company_id ON pos_transactions(company_id)",
    """UPDATE pos_transactions x SET company_id = s.company_id
        FROM pos_sessions s
        WHERE x.session_id = s.id AND x.company_id IS NULL AND s.company_id IS NOT NULL""",
    """UPDATE pos_transactions SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",

    # ── IntegrationType enum: agregar valores nuevos ─────────────────────
    # PostgreSQL requiere ALTER TYPE ADD VALUE. Idempotente con IF NOT EXISTS.
    "ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'MARKETPLACE_SHOPIFY'",
    "ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'INVOICING_SUFACTURA'",

    # ── Notas de Credito CFDI 4.0 (tablas + indices) ────────────────────
    # create_all normalmente las crea en el primer arranque; estos statements
    # garantizan idempotencia y agregan indices sobre foreign keys usados
    # por los list/filter comunes (order_id, status, company_id).
    """CREATE TABLE IF NOT EXISTS credit_notes (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR REFERENCES company_profile(id) ON DELETE CASCADE,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        customer_id INTEGER REFERENCES customers(id),
        folio VARCHAR(32) NOT NULL UNIQUE,
        kind VARCHAR(16) NOT NULL DEFAULT 'parcial',
        motivo_sat VARCHAR(4) NOT NULL,
        reason TEXT,
        subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
        discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        tax_rate DOUBLE PRECISION NOT NULL DEFAULT 16,
        tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        total DOUBLE PRECISION NOT NULL DEFAULT 0,
        currency VARCHAR(3) NOT NULL DEFAULT 'MXN',
        status VARCHAR(16) NOT NULL DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        cfdi_uuid VARCHAR(64),
        cfdi_serie VARCHAR(32),
        cfdi_folio VARCHAR(32),
        cfdi_xml BYTEA,
        cfdi_pdf BYTEA,
        cfdi_pac VARCHAR(32),
        "cfdi_selloDigital" TEXT,
        "cfdi_selloCFD" TEXT,
        "cfdi_noCertificadoSAT" VARCHAR(20),
        stamped_at TIMESTAMP WITH TIME ZONE,
        cancelled_at TIMESTAMP WITH TIME ZONE,
        cancellation_motivo VARCHAR(4),
        cancellation_folio_sustituto VARCHAR(64),
        cancellation_acuse TEXT,
        restocks_inventory INTEGER NOT NULL DEFAULT 0,
        warehouse_id INTEGER REFERENCES warehouses(id)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_credit_notes_company_id ON credit_notes(company_id)",
    "CREATE INDEX IF NOT EXISTS ix_credit_notes_order_id ON credit_notes(order_id)",
    "CREATE INDEX IF NOT EXISTS ix_credit_notes_status ON credit_notes(status)",
    "CREATE INDEX IF NOT EXISTS ix_credit_notes_cfdi_uuid ON credit_notes(cfdi_uuid)",
    """CREATE TABLE IF NOT EXISTS credit_note_items (
        id SERIAL PRIMARY KEY,
        company_id VARCHAR REFERENCES company_profile(id) ON DELETE CASCADE,
        credit_note_id INTEGER NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
        order_item_id INTEGER REFERENCES order_items(id),
        variant_id INTEGER REFERENCES product_variants(id),
        product_name VARCHAR NOT NULL,
        sku VARCHAR,
        quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
        unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
        discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        tax_rate DOUBLE PRECISION NOT NULL DEFAULT 16,
        subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
        tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        total DOUBLE PRECISION NOT NULL DEFAULT 0,
        clave_prod_serv VARCHAR(16),
        clave_unidad VARCHAR(8),
        unidad VARCHAR(32)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_credit_note_items_credit_note_id ON credit_note_items(credit_note_id)",
    "CREATE INDEX IF NOT EXISTS ix_credit_note_items_company_id ON credit_note_items(company_id)",

    # ── SystemIntegration multi-tenancy ───────────────────────────────────
    # Cada empresa cliente debe tener sus propias credenciales (Shopify,
    # Sufactura, SMTP…). Sin esto, todas las empresas comparten los mismos
    # registros — desastre para multiempresa.
    "ALTER TABLE system_integrations ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id) ON DELETE CASCADE",
    "ALTER TABLE system_integrations ADD COLUMN IF NOT EXISTS name VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_system_integrations_company_id ON system_integrations(company_id)",
    # provider_name era NOT NULL; ahora Shopify/Sufactura no lo usan.
    "ALTER TABLE system_integrations ALTER COLUMN provider_name DROP NOT NULL",
    # Backfill: los registros existentes van a la primera empresa (Elias Jabari).
    """UPDATE system_integrations SET company_id = (
        SELECT id FROM company_profile ORDER BY created_at ASC LIMIT 1
    ) WHERE company_id IS NULL""",
]


# ── Fase 1c · Tablas hijas también scoped (dashboards / módulos) ────
# Padre ya lleva company_id; ahora las hijas también, para que queries
# directas sobre ellas (sin JOIN al padre) filtren correctamente. La
# migración copia el company_id del padre a la hija via JOIN, y solo
# afecta filas donde la hija tenía NULL — 100% idempotente.
_TENANCY_CHILDREN_STATEMENTS = [
    # ── Sales children ───────────────────────────────────────────
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_order_items_company_id ON order_items(company_id)",
    """UPDATE order_items oi SET company_id = o.company_id
        FROM orders o WHERE oi.order_id = o.id AND oi.company_id IS NULL""",

    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_payments_company_id ON payments(company_id)",
    """UPDATE payments p SET company_id = o.company_id
        FROM orders o WHERE p.order_id = o.id AND p.company_id IS NULL""",

    "ALTER TABLE customer_returns ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_customer_returns_company_id ON customer_returns(company_id)",
    """UPDATE customer_returns cr SET company_id = o.company_id
        FROM orders o WHERE cr.order_id = o.id AND cr.company_id IS NULL""",

    # ── Inventory children ───────────────────────────────────────
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_product_variants_company_id ON product_variants(company_id)",
    """UPDATE product_variants pv SET company_id = p.company_id
        FROM products p WHERE pv.product_id = p.id AND pv.company_id IS NULL""",

    "ALTER TABLE stock_levels ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_levels_company_id ON stock_levels(company_id)",
    """UPDATE stock_levels sl SET company_id = w.company_id
        FROM warehouses w WHERE sl.warehouse_id = w.id AND sl.company_id IS NULL""",

    "ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_lots_company_id ON stock_lots(company_id)",
    """UPDATE stock_lots sl SET company_id = w.company_id
        FROM warehouses w WHERE sl.warehouse_id = w.id AND sl.company_id IS NULL""",

    "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_movements_company_id ON stock_movements(company_id)",
    """UPDATE stock_movements sm SET company_id = w.company_id
        FROM warehouses w WHERE sm.warehouse_id = w.id AND sm.company_id IS NULL""",

    "ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_poi_company_id ON purchase_order_items(company_id)",
    """UPDATE purchase_order_items poi SET company_id = po.company_id
        FROM purchase_orders po WHERE poi.purchase_order_id = po.id AND poi.company_id IS NULL""",

    # ── Retail children ──────────────────────────────────────────
    "ALTER TABLE retail_stores ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_retail_stores_company_id ON retail_stores(company_id)",
    """UPDATE retail_stores rs SET company_id = rc.company_id
        FROM retail_channels rc WHERE rs.channel_id = rc.id AND rs.company_id IS NULL""",

    "ALTER TABLE retail_alerts ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_retail_alerts_company_id ON retail_alerts(company_id)",
    """UPDATE retail_alerts ra SET company_id = rc.company_id
        FROM retail_channels rc WHERE ra.channel_id = rc.id AND ra.company_id IS NULL""",

    "ALTER TABLE retail_sellout_reports ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_sellout_company_id ON retail_sellout_reports(company_id)",
    """UPDATE retail_sellout_reports so SET company_id = rs.company_id
        FROM retail_stores rs WHERE so.store_id = rs.id AND so.company_id IS NULL""",

    # ── HR children ──────────────────────────────────────────────
    "ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_hr_attendance_company_id ON hr_attendance(company_id)",
    """UPDATE hr_attendance a SET company_id = e.company_id
        FROM hr_employees e WHERE a.employee_id = e.id AND a.company_id IS NULL""",

    "ALTER TABLE hr_payroll_details ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_hr_payroll_details_company_id ON hr_payroll_details(company_id)",
    """UPDATE hr_payroll_details pd SET company_id = e.company_id
        FROM hr_employees e WHERE pd.employee_id = e.id AND pd.company_id IS NULL""",

    "ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_hr_contracts_company_id ON hr_contracts(company_id)",
    """UPDATE hr_contracts c SET company_id = e.company_id
        FROM hr_employees e WHERE c.employee_id = e.id AND c.company_id IS NULL""",

    # ── Finance children ─────────────────────────────────────────
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_bank_transactions_company_id ON bank_transactions(company_id)",
    """UPDATE bank_transactions bt SET company_id = ba.company_id
        FROM bank_accounts ba WHERE bt.bank_account_id = ba.id AND bt.company_id IS NULL""",

    "ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_bill_payments_company_id ON bill_payments(company_id)",
    """UPDATE bill_payments bp SET company_id = sb.company_id
        FROM supplier_bills sb WHERE bp.bill_id = sb.id AND bp.company_id IS NULL""",

    # ── POS children ─────────────────────────────────────────────
    # POSSession no tiene padre scoped (POSTerminal.warehouse_id apunta
    # a Warehouse pero no siempre); bulk update la deja NULL — se
    # asigna correctamente en próximas ventas via before_flush del
    # tenancy listener. Alternativa: via warehouse del terminal.
    "ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_pos_sessions_company_id ON pos_sessions(company_id)",
    """UPDATE pos_sessions ps SET company_id = w.company_id
        FROM pos_terminals pt JOIN warehouses w ON w.id = pt.warehouse_id
        WHERE ps.terminal_id = pt.id AND ps.company_id IS NULL""",

    "ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES company_profile(id)",
    "CREATE INDEX IF NOT EXISTS ix_pos_transactions_company_id ON pos_transactions(company_id)",
    """UPDATE pos_transactions pt SET company_id = ps.company_id
        FROM pos_sessions ps WHERE pt.session_id = ps.id AND pt.company_id IS NULL""",

    # Workflow de aprobación para eliminación de productos
    """CREATE TABLE IF NOT EXISTS product_deletion_requests (
        id                    SERIAL PRIMARY KEY,
        company_id            VARCHAR REFERENCES company_profile(id),
        product_id            INTEGER NOT NULL REFERENCES products(id),
        requested_by_user_id  INTEGER NOT NULL REFERENCES users(id),
        reason                TEXT NOT NULL,
        status                VARCHAR NOT NULL DEFAULT 'pending',
        approved_by_user_id   INTEGER REFERENCES users(id),
        approved_at           TIMESTAMPTZ,
        rejected_at           TIMESTAMPTZ,
        rejection_reason      TEXT,
        executed_at           TIMESTAMPTZ,
        created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS ix_pdr_status ON product_deletion_requests(status)",
    "CREATE INDEX IF NOT EXISTS ix_pdr_company ON product_deletion_requests(company_id)",
    "CREATE INDEX IF NOT EXISTS ix_pdr_product ON product_deletion_requests(product_id)",
]


# ── Actualización de política RBAC (idempotente) ─────────────────────
# Cambios acordados con el usuario (Fase 15):
#   1. Nuevo módulo 'retail' + sus 5 permisos (view/create/edit/delete/approve).
#   2. Rol "Gerente Ventas" gana retail.{view,create,edit,approve} y
#      pierde reports.*  → el KPI ejecutivo queda solo para Admin.
#   3. Rol "Contador" gana sales.view — necesario para conciliar
#      facturas contra ventas del ERP.
# Todo con INSERT ON CONFLICT DO NOTHING y DELETE con subquery — se
# puede correr múltiples veces sin efecto duplicado. NO toca roles
# personalizados del cliente (solo los tres nombres canónicos).
_RBAC_POLICY_UPDATES = [
    # 1. Permisos del módulo retail (5 acciones × una fila)
    """INSERT INTO permissions (module, action, description)
        SELECT 'retail', a, 'Retail / Cadenas · ' || a
        FROM unnest(ARRAY['view','create','edit','delete','approve']) AS a
        WHERE NOT EXISTS (
            SELECT 1 FROM permissions p WHERE p.module = 'retail' AND p.action = a
        )""",

    # 2a. Asegurar retail.{view,create,edit,approve} para "Gerente Ventas"
    """INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r, permissions p
        WHERE r.name = 'Gerente Ventas'
          AND p.module = 'retail'
          AND p.action IN ('view','create','edit','approve')
          AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp
              WHERE rp.role_id = r.id AND rp.permission_id = p.id
          )""",

    # 2b. Quitar reports.* del rol "Gerente Ventas"
    """DELETE FROM role_permissions
        WHERE role_id IN (SELECT id FROM roles WHERE name = 'Gerente Ventas')
          AND permission_id IN (SELECT id FROM permissions WHERE module = 'reports')""",

    # 3. Dar sales.view al rol "Contador"
    """INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r, permissions p
        WHERE r.name = 'Contador'
          AND p.module = 'sales'
          AND p.action = 'view'
          AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp
              WHERE rp.role_id = r.id AND rp.permission_id = p.id
          )""",
]


def _apply(sync_conn: Connection) -> None:
    if sync_conn.dialect.name != "postgresql":
        return

    all_statements = [
        ("customers",  _CUSTOMER_STATEMENTS),
        ("sales",      _SALES_STATEMENTS),
        ("sales_agents", _SALES_AGENTS_STATEMENTS),
        ("universal_erp", _UNIVERSAL_ERP_STATEMENTS),
        ("ingesta",    _INGESTA_STATEMENTS),
        ("inventory",  _INVENTORY_STATEMENTS),
        ("finance",    _FINANCE_STATEMENTS),
        ("hr",         _HR_STATEMENTS),
        ("auth",       _AUTH_STATEMENTS),
        ("branches",   _BRANCH_STATEMENTS),
        ("retail",     _RETAIL_STATEMENTS),
        ("promotions", _PROMOTIONS_STATEMENTS),
        ("loyalty",    _LOYALTY_STATEMENTS),
        ("assistant",  _ASSISTANT_STATEMENTS),
        # Corre DESPUÉS de assistant y auth: necesita que existan las
        # tablas 'permissions', 'roles' y 'role_permissions' (que crea
        # SQLAlchemy con Base.metadata.create_all en el startup).
        ("rbac_policy", _RBAC_POLICY_UPDATES),
        # Corre después que create_all haya generado la tabla company_profile.
        ("brand_fields", _BRAND_FIELDS_STATEMENTS),
        # Corre DESPUÉS de brand_fields para asegurar que company_profile
        # ya tenga los campos completos cuando se referencia por FK.
        ("tenancy", _TENANCY_STATEMENTS),
        # Corre DESPUÉS de tenancy: las hijas heredan del padre.
        ("tenancy_children", _TENANCY_CHILDREN_STATEMENTS),
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
