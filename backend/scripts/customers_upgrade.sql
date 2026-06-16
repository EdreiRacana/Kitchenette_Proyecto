-- Actualización de la tabla `customers` para el módulo profesional de clientes.
-- Ejecútalo UNA vez contra tu Postgres de Render (dashboard → DB → PSQL).
-- Es seguro y repetible: ADD COLUMN IF NOT EXISTS no rompe si ya existe.
--
-- Por qué: el startup hace `Base.metadata.create_all`, que SOLO crea tablas
-- faltantes; NO agrega columnas nuevas a una tabla existente. Por eso van aquí.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_number    VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_type      VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS razon_social     VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc              VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS regimen_fiscal   VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS uso_cfdi         VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cuenta_contable  VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sucursal         VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list       VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_days      INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_amount    DOUBLE PRECISION DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS discount_pact    DOUBLE PRECISION DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_number   VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_agent      VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_agent     VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS how_heard        VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phones           TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pais             VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS estado           VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS municipio        VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS localidad        VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS calle            VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS colonia          VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_postal    VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_exterior      VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_interior      VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_colonia   VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_localidad VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referencia       TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes            TEXT;

-- Numera los clientes que ya existían (CLI-00001, ...) y fija tipo por defecto.
UPDATE customers SET client_number = 'CLI-' || lpad(id::text, 5, '0') WHERE client_number IS NULL;
UPDATE customers SET client_type = 'Contado' WHERE client_type IS NULL;
UPDATE customers SET pais = 'México' WHERE pais IS NULL;
UPDATE customers SET uso_cfdi = 'G03' WHERE uso_cfdi IS NULL;
UPDATE customers SET cuenta_contable = '105-01-001' WHERE cuenta_contable IS NULL;

-- Índices para búsqueda/filtrado del módulo.
CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_client_number ON customers (client_number);
CREATE INDEX IF NOT EXISTS ix_customers_client_type ON customers (client_type);
CREATE INDEX IF NOT EXISTS ix_customers_sucursal    ON customers (sucursal);
CREATE INDEX IF NOT EXISTS ix_customers_rfc         ON customers (rfc);
