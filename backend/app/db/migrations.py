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
    "CREATE INDEX IF NOT EXISTS ix_supplier_documents_supplier ON supplier_documents (supplier_id)",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_product_variants_barcode ON product_variants (barcode)",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reorder_point INTEGER",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS safety_stock INTEGER",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS lead_time_days INTEGER",
    "ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS preferred_supplier_id INTEGER",
    "ALTER TABLE stock_levels ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER DEFAULT 0",
    "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_amount  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS due_date     TIMESTAMPTZ",
    "UPDATE purchase_orders SET total_amount = 0 WHERE total_amount IS NULL",
    "UPDATE purchase_orders SET paid_amount = 0 WHERE paid_amount IS NULL",
    "UPDATE stock_movements SET movement_type = lower(movement_type) WHERE movement_type <> lower(movement_type)",
    "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS extra_costs JSONB",
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
]

_AUTH_STATEMENTS = [
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS color VARCHAR",
    "UPDATE roles SET is_system = FALSE WHERE is_system IS NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes VARCHAR",
    "UPDATE users SET two_factor_enabled = FALSE WHERE two_factor_enabled IS NULL",
]

_BRANCH_STATEMENTS = [
    "ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    "ALTER TABLE budgets ADD COLUMN IF NOT EXISTS branch_id INTEGER",
    # Tasa ISN estatal (patronal) en el perfil de la empresa
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS state_payroll_tax_rate DOUBLE PRECISION DEFAULT 3.0",
    # Logo persistente en la DB (el filesystem de Render es efímero)
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS logo_bytes BYTEA",
    "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS logo_mime  VARCHAR",
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
    # Conciliación bancaria
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_date TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS matched_transaction_id INTEGER REFERENCES transactions(id)",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual'",
    "ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS external_ref VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_bank_tx_ext_ref ON bank_transactions (bank_account_id, external_ref)",
]


_RETAIL_STATEMENTS = [
    # Config de alertas por cadena (agregada tras la Fase 3)
    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS no_movement_days     INTEGER DEFAULT 21 NOT NULL",
    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS sell_through_min_pct DOUBLE PRECISION DEFAULT 20.0 NOT NULL",
    "ALTER TABLE retail_channels ADD COLUMN IF NOT EXISTS alerts_enabled       BOOLEAN DEFAULT TRUE NOT NULL",
    # Consignación (Fase 4)
    "ALTER TABLE retail_stores          ADD COLUMN IF NOT EXISTS consignment_warehouse_id INTEGER REFERENCES warehouses(id)",
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
