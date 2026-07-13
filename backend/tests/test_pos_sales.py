"""Tests de flujos críticos del POS y ventas.

Cubre los bugs que ya cazamos en producción para evitar regresiones:
  - Efectivo y tarjeta duplicados en el ticket
  - IVA mal desglosado
  - Backend acepta pago sólo efectivo, sólo tarjeta, o mixto
  - Historial de ventas del turno funciona
  - No permite exceder total con tarjeta+transferencia
"""
import pytest
from datetime import datetime, timezone


@pytest.mark.asyncio
class TestPOSSession:
    async def test_open_close_session(self, db, terminal, user):
        from app.modules.pos import service as pos_svc
        result = await pos_svc.open_session(
            db, terminal_id=terminal.id, cashier_id=user.id,
            opening_balance=500.0,
        )
        assert result["id"] > 0
        assert result["opening_balance"] == 500.0

    async def test_only_one_open_session_per_terminal(self, db, terminal, user):
        from app.modules.pos import service as pos_svc
        await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=500.0)
        with pytest.raises(ValueError, match="ya tiene una sesión abierta"):
            await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=500.0)


@pytest.mark.asyncio
class TestPOSSale:
    async def test_sale_cash_only(self, db, terminal, user, product):
        """Venta 100% efectivo con cambio."""
        from app.modules.pos import service as pos_svc
        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=500.0)
        result = await pos_svc.register_sale(
            db, session_id=s["id"], customer_id=None,
            items=[{"variant_id": product.id, "product_name": "Producto Test",
                    "sku": product.sku, "quantity": 2, "unit_price": 116.0,
                    "discount_amount": 0.0, "tax_rate": 16.0, "is_service": False}],
            payments={"cash": 300.0}, tax_rate=16.0, user_id=user.id,
        )
        assert result["total_amount"] == 232.0
        assert result["change"] == 68.0
        assert result["paid_amount"] == 300.0

    async def test_sale_card_only_exact(self, db, terminal, user, product):
        """Venta 100% tarjeta con monto exacto."""
        from app.modules.pos import service as pos_svc
        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        result = await pos_svc.register_sale(
            db, session_id=s["id"], customer_id=None,
            items=[{"variant_id": product.id, "product_name": "P", "sku": product.sku,
                    "quantity": 1, "unit_price": 500.0, "discount_amount": 0.0,
                    "tax_rate": 16.0, "is_service": False}],
            payments={"card": 500.0}, tax_rate=16.0, user_id=user.id,
        )
        assert result["total_amount"] == 500.0
        assert result["change"] == 0.0

    async def test_sale_mixed_payment(self, db, terminal, user, product):
        """Pago mixto: $300 tarjeta + $200 efectivo = $500 exacto."""
        from app.modules.pos import service as pos_svc
        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        result = await pos_svc.register_sale(
            db, session_id=s["id"], customer_id=None,
            items=[{"variant_id": product.id, "product_name": "P", "sku": product.sku,
                    "quantity": 1, "unit_price": 500.0, "discount_amount": 0.0,
                    "tax_rate": 16.0, "is_service": False}],
            payments={"card": 300.0, "cash": 200.0}, tax_rate=16.0, user_id=user.id,
        )
        assert result["total_amount"] == 500.0
        assert result["paid_amount"] == 500.0
        assert result["change"] == 0.0
        # Verifica que se crearon EXACTAMENTE 2 payments (no duplicados)
        from app.modules.sales import models as sales_models
        from sqlalchemy.future import select
        res = await db.execute(
            select(sales_models.Payment).where(sales_models.Payment.order_id == result["order_id"])
        )
        pays = res.scalars().all()
        assert len(pays) == 2
        methods = sorted(p.method for p in pays)
        assert methods == ["card", "cash"]

    async def test_card_cannot_exceed_total(self, db, terminal, user, product):
        """Bug clásico: tarjeta+transferencia no pueden exceder el total (no dan cambio)."""
        from app.modules.pos import service as pos_svc
        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        with pytest.raises(ValueError, match="excede el total"):
            await pos_svc.register_sale(
                db, session_id=s["id"], customer_id=None,
                items=[{"variant_id": product.id, "product_name": "P", "sku": product.sku,
                        "quantity": 1, "unit_price": 100.0, "discount_amount": 0.0,
                        "tax_rate": 16.0, "is_service": False}],
                payments={"card": 200.0}, tax_rate=16.0, user_id=user.id,
            )

    async def test_underpayment_rejected(self, db, terminal, user, product):
        """Pago menor al total → error."""
        from app.modules.pos import service as pos_svc
        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        with pytest.raises(ValueError, match="menor que el total"):
            await pos_svc.register_sale(
                db, session_id=s["id"], customer_id=None,
                items=[{"variant_id": product.id, "product_name": "P", "sku": product.sku,
                        "quantity": 1, "unit_price": 500.0, "discount_amount": 0.0,
                        "tax_rate": 16.0, "is_service": False}],
                payments={"cash": 200.0}, tax_rate=16.0, user_id=user.id,
            )

    async def test_session_sales_history(self, db, terminal, user, product):
        """El historial del turno debe listar las ventas creadas."""
        from app.modules.pos import service as pos_svc
        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        # Hacer 3 ventas
        for i in range(3):
            await pos_svc.register_sale(
                db, session_id=s["id"], customer_id=None,
                items=[{"variant_id": product.id, "product_name": "P", "sku": product.sku,
                        "quantity": 1, "unit_price": 100.0, "discount_amount": 0.0,
                        "tax_rate": 16.0, "is_service": False}],
                payments={"cash": 100.0}, tax_rate=16.0, user_id=user.id,
            )
        history = await pos_svc.list_session_sales(db, s["id"])
        assert len(history) == 3
        assert all(h["total_amount"] == 100.0 for h in history)
        assert all(len(h["payment_methods"]) == 1 for h in history)


@pytest.mark.asyncio
class TestTicketMath:
    """Verifica que el desglose de IVA en el ticket es matemáticamente correcto."""

    async def test_iva_breakdown_price_includes_iva(self, db, terminal, user, product):
        """En POS el precio ya incluye IVA. El ticket debe mostrar:
           Subtotal (sin IVA) + IVA = Total (con IVA)."""
        from app.modules.pos import service as pos_svc
        from app.modules.pos import pdf_ticket
        from pypdf import PdfReader
        import io

        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        r = await pos_svc.register_sale(
            db, session_id=s["id"], customer_id=None,
            items=[{"variant_id": product.id, "product_name": "Producto",
                    "sku": product.sku, "quantity": 1, "unit_price": 1000.0,
                    "discount_amount": 0.0, "tax_rate": 16.0, "is_service": False}],
            payments={"cash": 1000.0}, tax_rate=16.0, user_id=user.id,
        )
        ticket_data = await pos_svc.prepare_ticket_data(db, r["order_id"])
        pdf = pdf_ticket.build_thermal_ticket(
            company=ticket_data["company"], order=ticket_data["order"],
            items=ticket_data["items"], payments=ticket_data["payments"],
            session=ticket_data["session"], width_mm=80,
        )
        text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
        # 1000 con IVA incluido:
        # subtotal = 1000 - IVA = 1000 - (1000 * 16/116) = 1000 - 137.93 = 862.07
        assert "Subtotal: $862.07" in text
        assert "IVA (16%): $137.93" in text
        assert "TOTAL: $1,000.00" in text

    async def test_ticket_shows_all_payment_methods_no_duplicates(self, db, terminal, user, product):
        """Bug histórico: el ticket duplicaba efectivo+tarjeta cuando sólo hubo un método."""
        from app.modules.pos import service as pos_svc
        from app.modules.pos import pdf_ticket
        from pypdf import PdfReader
        import io

        s = await pos_svc.open_session(db, terminal_id=terminal.id, cashier_id=user.id, opening_balance=0.0)
        r = await pos_svc.register_sale(
            db, session_id=s["id"], customer_id=None,
            items=[{"variant_id": product.id, "product_name": "Producto", "sku": product.sku,
                    "quantity": 1, "unit_price": 500.0, "discount_amount": 0.0,
                    "tax_rate": 16.0, "is_service": False}],
            payments={"card": 200.0, "cash": 300.0}, tax_rate=16.0, user_id=user.id,
        )
        ticket_data = await pos_svc.prepare_ticket_data(db, r["order_id"])
        pdf = pdf_ticket.build_thermal_ticket(
            company=ticket_data["company"], order=ticket_data["order"],
            items=ticket_data["items"], payments=ticket_data["payments"],
            session=ticket_data["session"], width_mm=80,
        )
        text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
        # DEBE aparecer AMBOS métodos, con los MONTOS CORRECTOS, sin duplicar
        assert "Tarjeta: $200.00" in text
        assert "Efectivo: $300.00" in text
        # NO debe aparecer el monto total como si fuera un método individual
        assert "Tarjeta: $500.00" not in text
        assert "Efectivo: $500.00" not in text


@pytest.mark.asyncio
class TestSupplierBug:
    """El bug del proveedor: create_supplier retornaba sin selectinload(documents),
    causando 500 al serializar (aunque el commit ya había pasado → duplicados)."""

    async def test_create_supplier_returns_documents_relation(self, db):
        from app.modules.inventory import service as inv_svc
        from app.modules.inventory import schemas
        data = schemas.SupplierCreate(name="Proveedor Test", rfc="AAA010101AAA")
        supplier = await inv_svc.create_supplier(db, data)
        # Antes del fix, tocar documents disparaba lazy-load y explotaba
        assert supplier.documents == []
        assert supplier.name == "Proveedor Test"
