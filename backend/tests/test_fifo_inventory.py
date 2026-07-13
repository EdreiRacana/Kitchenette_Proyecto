"""Tests del motor FIFO de inventario.

Cubre:
  - receive_stock crea lote con quantity_remaining = quantity_received
  - consume_stock consume del lote más antiguo primero (PEPS)
  - Cuando se agota un lote, sigue con el siguiente
  - unit_cost_avg es el promedio ponderado real de los lotes consumidos
  - allow_negative=True permite consumo sin stock (para no bloquear ventas)
  - StockLevel se ajusta correctamente
"""
import pytest


@pytest.mark.asyncio
class TestFIFO:
    async def test_receive_creates_lot(self, db, product, warehouse):
        """receive_stock crea un lote con la cantidad y costo indicados."""
        from app.modules.inventory import fifo_service
        lot = await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=10, unit_cost=100.0, reference="OC-001",
        )
        assert lot.quantity_received == 10
        assert lot.quantity_remaining == 10
        assert lot.unit_cost == 100.0

    async def test_consume_single_lot(self, db, product, warehouse):
        """Consumo de un solo lote → unit_cost_avg = unit_cost del lote."""
        from app.modules.inventory import fifo_service
        await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=10, unit_cost=100.0, reference="OC-001",
        )
        result = await fifo_service.consume_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=3, reference="ORD-001",
        )
        assert result["unit_cost_avg"] == 100.0
        assert result["total_cost"] == 300.0
        assert len(result["lots_used"]) == 1
        assert result["lots_used"][0]["qty"] == 3

    async def test_consume_across_multiple_lots_fifo_order(self, db, product, warehouse):
        """Al consumir más que un lote, debe agotar el primero (más antiguo)
        antes de tocar el siguiente, y el unit_cost_avg refleja el promedio ponderado."""
        from app.modules.inventory import fifo_service
        # Lote 1: 10 unidades a $100
        await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=10, unit_cost=100.0, reference="OC-001",
        )
        # Lote 2: 10 unidades a $150 (más caro, comprado después)
        await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=10, unit_cost=150.0, reference="OC-002",
        )
        # Consumir 15 → debe usar los 10 del lote 1 y 5 del lote 2
        result = await fifo_service.consume_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=15, reference="ORD-001",
        )
        # 10 × 100 + 5 × 150 = 1000 + 750 = 1750
        assert result["total_cost"] == 1750.0
        # Promedio ponderado: 1750 / 15 = 116.6667
        assert abs(result["unit_cost_avg"] - 116.6667) < 0.001
        assert len(result["lots_used"]) == 2
        assert result["lots_used"][0]["qty"] == 10 and result["lots_used"][0]["unit_cost"] == 100.0
        assert result["lots_used"][1]["qty"] == 5 and result["lots_used"][1]["unit_cost"] == 150.0

    async def test_consume_insufficient_raises_when_strict(self, db, product, warehouse):
        """Sin stock y allow_negative=False → InsufficientStockError."""
        from app.modules.inventory import fifo_service
        await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=5, unit_cost=100.0, reference="OC-001",
        )
        with pytest.raises(fifo_service.InsufficientStockError):
            await fifo_service.consume_stock(
                db, variant_id=product.id, warehouse_id=warehouse.id,
                quantity=10, reference="ORD-001", allow_negative=False,
            )

    async def test_consume_insufficient_allows_negative(self, db, product, warehouse):
        """Con allow_negative=True → consume lo que hay + warning por lo faltante."""
        from app.modules.inventory import fifo_service
        await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=5, unit_cost=100.0, reference="OC-001",
        )
        result = await fifo_service.consume_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=10, reference="ORD-001", allow_negative=True,
        )
        # Consume los 5 disponibles + registra 5 sin lote
        assert result["total_cost"] == 500.0  # 5 × 100
        # unit_cost_avg = 500 / 10 = 50 (5 unidades gratis diluyen el costo)
        assert result["unit_cost_avg"] == 50.0
        warning_lot = [l for l in result["lots_used"] if l.get("warning")]
        assert len(warning_lot) == 1
        assert warning_lot[0]["qty"] == 5

    async def test_stock_level_reflects_consumption(self, db, product, warehouse):
        """El StockLevel agregado debe bajar tras consumir."""
        from app.modules.inventory import fifo_service, models as inv_models
        from sqlalchemy.future import select
        await fifo_service.receive_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=20, unit_cost=100.0, reference="OC-001",
        )
        await fifo_service.consume_stock(
            db, variant_id=product.id, warehouse_id=warehouse.id,
            quantity=7, reference="ORD-001",
        )
        res = await db.execute(select(inv_models.StockLevel).where(
            inv_models.StockLevel.variant_id == product.id,
            inv_models.StockLevel.warehouse_id == warehouse.id,
        ))
        lvl = res.scalars().first()
        # 20 - 7 = 13
        assert lvl.quantity == 13

    async def test_kardex_shows_chronological_movements(self, db, product, warehouse):
        """El kardex debe tener las entradas y salidas con saldo acumulado."""
        from app.modules.inventory import fifo_service
        await fifo_service.receive_stock(db, variant_id=product.id, warehouse_id=warehouse.id,
                                          quantity=10, unit_cost=100.0, reference="IN-1")
        await fifo_service.consume_stock(db, variant_id=product.id, warehouse_id=warehouse.id,
                                           quantity=3, reference="OUT-1")
        await fifo_service.receive_stock(db, variant_id=product.id, warehouse_id=warehouse.id,
                                          quantity=5, unit_cost=120.0, reference="IN-2")
        kardex = await fifo_service.get_kardex(db, variant_id=product.id, warehouse_id=warehouse.id)
        assert kardex["current_balance"] == 12  # 10 - 3 + 5
        assert kardex["total_received"] == 15
        assert kardex["total_shipped"] == 3
        assert len(kardex["movements"]) == 3
