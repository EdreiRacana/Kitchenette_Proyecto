-- Índices para acelerar el módulo de ventas (Sales / CRM).
-- Ejecútalo UNA sola vez contra tu Postgres de Render.
--   Render → tu servicio de DB → "Connect" → PSQL Command, pega esto.
-- Es seguro y repetible: IF NOT EXISTS no rompe si ya existen.
--
-- Por qué: `Base.metadata.create_all` en el startup solo CREA tablas que no
-- existen; NO agrega índices nuevos a una tabla que ya existe. Por eso los
-- índices se aplican aquí a mano (o vía una migración de Alembic).

-- Cubre el filtro típico de la analítica y del listado:
--   WHERE kind='order' AND status<>'cancelled' [AND created_at >= ...] ORDER BY created_at
CREATE INDEX IF NOT EXISTS ix_orders_kind_status_created
    ON orders (kind, status, created_at);

-- Orden por fecha en el listado general y ventana de fechas del trend.
CREATE INDEX IF NOT EXISTS ix_orders_created_at
    ON orders (created_at);

-- top-customers agrupa por cliente; el FK no se indexa solo en Postgres.
CREATE INDEX IF NOT EXISTS ix_orders_customer_id
    ON orders (customer_id);

-- top-products hace JOIN order_items -> orders por order_id.
CREATE INDEX IF NOT EXISTS ix_order_items_order_id
    ON order_items (order_id);

-- Opcional, si la tabla `orders` ya es MUY grande y no quieres bloquearla
-- mientras se crea el índice, usa la variante CONCURRENTLY (una por una,
-- fuera de transacción):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_orders_kind_status_created
--       ON orders (kind, status, created_at);
