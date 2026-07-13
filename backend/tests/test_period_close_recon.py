"""Tests de cierre contable + conciliación bancaria.

Cubre:
  - Cerrar período crea PeriodClose con snapshot
  - No permite cerrar dos veces el mismo mes
  - Reabrir cambia status y deja rastro
  - Crear póliza en mes cerrado → ValueError con mensaje explicativo
  - Parser CSV con formato BBVA (Cargo/Abono con coma)
  - Parser CSV con formato Santander (delimitador ;)
  - Parser CSV con columna Monto único (positivo/negativo)
  - Parser XLSX equivalente
"""
import io
import pytest
from datetime import datetime, timezone


@pytest.mark.asyncio
class TestPeriodClose:
    async def test_close_period_creates_record(self, db, user):
        from app.modules.accounting import service as acc_svc
        result = await acc_svc.close_period(db, year=2026, month=6, user_id=user.id, notes="Test close")
        assert result["year"] == 2026
        assert result["month"] == 6
        assert result["status"] == "closed"
        assert result["id"] > 0

    async def test_cannot_close_twice(self, db, user):
        from app.modules.accounting import service as acc_svc
        await acc_svc.close_period(db, year=2026, month=6, user_id=user.id)
        with pytest.raises(ValueError, match="ya está cerrado"):
            await acc_svc.close_period(db, year=2026, month=6, user_id=user.id)

    async def test_reopen_period(self, db, user):
        from app.modules.accounting import service as acc_svc
        await acc_svc.close_period(db, year=2026, month=6, user_id=user.id)
        result = await acc_svc.reopen_period(db, year=2026, month=6, user_id=user.id, reason="Error captura")
        assert result["status"] == "reopened"
        # Y ahora se puede volver a cerrar
        result2 = await acc_svc.close_period(db, year=2026, month=6, user_id=user.id)
        assert result2["status"] == "closed"

    async def test_cannot_create_entry_in_closed_period(self, db, user):
        from app.modules.accounting import service as acc_svc
        from app.modules.accounting import schemas as acc_schemas
        from app.modules.accounting import models as acc_models
        # Setup: catálogo mínimo con 2 cuentas contables
        a1 = acc_models.Account(code="1000", name="Caja", account_type="activo", nature="deudora", is_postable=True)
        a2 = acc_models.Account(code="2000", name="Ventas", account_type="ingreso", nature="acreedora", is_postable=True)
        db.add_all([a1, a2])
        await db.commit()
        await db.refresh(a1); await db.refresh(a2)

        # Cerrar junio 2026
        await acc_svc.close_period(db, year=2026, month=6, user_id=user.id)

        # Intentar crear póliza con fecha en junio → debe fallar
        entry_data = acc_schemas.JournalEntryCreate(
            date=datetime(2026, 6, 15, tzinfo=timezone.utc),
            entry_type="diario", concept="Test",
            lines=[
                acc_schemas.JournalLineCreate(account_id=a1.id, debit=100.0, credit=0.0),
                acc_schemas.JournalLineCreate(account_id=a2.id, debit=0.0, credit=100.0),
            ],
        )
        with pytest.raises(ValueError, match="cerrado"):
            await acc_svc.create_entry(db, entry_data, user_id=user.id)

    async def test_entry_allowed_after_reopen(self, db, user):
        from app.modules.accounting import service as acc_svc
        from app.modules.accounting import schemas as acc_schemas
        from app.modules.accounting import models as acc_models
        a1 = acc_models.Account(code="1000", name="Caja", account_type="activo", nature="deudora", is_postable=True)
        a2 = acc_models.Account(code="2000", name="Ventas", account_type="ingreso", nature="acreedora", is_postable=True)
        db.add_all([a1, a2])
        await db.commit()
        await db.refresh(a1); await db.refresh(a2)

        await acc_svc.close_period(db, year=2026, month=6, user_id=user.id)
        await acc_svc.reopen_period(db, year=2026, month=6, user_id=user.id, reason="Correcciones")

        entry = acc_schemas.JournalEntryCreate(
            date=datetime(2026, 6, 15, tzinfo=timezone.utc),
            entry_type="diario", concept="Post-reapertura",
            lines=[
                acc_schemas.JournalLineCreate(account_id=a1.id, debit=100.0, credit=0.0),
                acc_schemas.JournalLineCreate(account_id=a2.id, debit=0.0, credit=100.0),
            ],
        )
        result = await acc_svc.create_entry(db, entry, user_id=user.id)
        assert result.total_debit == 100.0


class TestReconciliationParser:
    """Parser de extractos bancarios — sin BD, pura lógica."""

    def test_csv_bbva_format(self):
        """BBVA: Fecha, Concepto, Cargo, Abono con coma."""
        from app.modules.finance import reconciliation
        csv = b"""Fecha,Concepto,Cargo,Abono
15/07/2026,PAGO CLIENTE,,150000.00
16/07/2026,COMISION,150.00,
"""
        rows = reconciliation._parse_csv(csv)
        assert len(rows) == 2
        assert rows[0]["amount"] == 150000.0  # abono positivo
        assert rows[1]["amount"] == -150.0    # cargo negativo

    def test_csv_santander_semicolon(self):
        """Santander: mismo layout pero delimitador ;"""
        from app.modules.finance import reconciliation
        csv = b"""Fecha;Descripcion;Cargo;Abono
15/07/2026;PAGO;;250000
"""
        rows = reconciliation._parse_csv(csv)
        assert len(rows) == 1
        assert rows[0]["amount"] == 250000.0

    def test_csv_monto_unico(self):
        """Formato con columna Monto único (positivo=abono, negativo=cargo)."""
        from app.modules.finance import reconciliation
        csv = b"""Fecha,Descripcion,Monto
15/07/2026,Deposito,50000
16/07/2026,Retiro,-30000
"""
        rows = reconciliation._parse_csv(csv)
        assert len(rows) == 2
        assert rows[0]["amount"] == 50000.0
        assert rows[1]["amount"] == -30000.0

    def test_xlsx_parse(self):
        """Parser XLSX debe funcionar igual que CSV."""
        from app.modules.finance import reconciliation
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active
        ws.append(["Fecha", "Concepto", "Cargo", "Abono"])
        ws.append(["15/07/2026", "PAGO", None, 100000])
        ws.append(["16/07/2026", "COMISION", 200, None])
        buf = io.BytesIO(); wb.save(buf)
        rows = reconciliation._parse_xlsx(buf.getvalue())
        assert len(rows) == 2
        assert rows[0]["amount"] == 100000.0
        assert rows[1]["amount"] == -200.0

    def test_csv_missing_date_column_raises(self):
        from app.modules.finance import reconciliation
        csv = b"""Concepto,Monto
PAGO,1000
"""
        with pytest.raises(ValueError, match="fecha"):
            reconciliation._parse_csv(csv)

    def test_csv_missing_amount_column_raises(self):
        from app.modules.finance import reconciliation
        csv = b"""Fecha,Concepto
15/07/2026,PAGO
"""
        with pytest.raises(ValueError, match="importe|Monto"):
            reconciliation._parse_csv(csv)


@pytest.mark.asyncio
class TestReconciliationMatching:
    async def test_matching_by_date_and_amount(self, db, bank_account):
        """Una transacción del sistema debe matchear con un movimiento del banco
        del mismo signo, monto exacto y fecha ±3 días."""
        from app.modules.finance import reconciliation
        from app.modules.finance import models as fin_models

        # Transacción en el sistema: ingreso $5000 el 15/jul
        tx = fin_models.Transaction(
            type="income", amount=5000.0, category="sales",
            description="Pago cliente X", reference="ORD-001",
        )
        tx.created_at = datetime(2026, 7, 15, tzinfo=timezone.utc)
        db.add(tx)
        await db.commit()

        # Extracto bancario con el mismo depósito el 16/jul (1 día después)
        csv = b"""Fecha,Concepto,Cargo,Abono
16/07/2026,Deposito cliente,,5000.00
"""
        result = await reconciliation.import_statement(
            db, bank_account_id=bank_account.id,
            file_bytes=csv, filename="extracto.csv",
        )
        assert result["imported"] == 1
        assert result["matched"] == 1
        assert result["unmatched"] == 0
        assert result["match_rate"] == 100.0

    async def test_no_match_when_amount_differs(self, db, bank_account):
        """Monto distinto → no matchea."""
        from app.modules.finance import reconciliation
        from app.modules.finance import models as fin_models

        tx = fin_models.Transaction(
            type="income", amount=5000.0, category="sales",
            description="X", reference="ORD-001",
        )
        tx.created_at = datetime(2026, 7, 15, tzinfo=timezone.utc)
        db.add(tx)
        await db.commit()

        csv = b"""Fecha,Concepto,Cargo,Abono
15/07/2026,Otro concepto,,4999.99
"""
        result = await reconciliation.import_statement(
            db, bank_account_id=bank_account.id,
            file_bytes=csv, filename="e.csv",
        )
        assert result["matched"] == 0
        assert result["unmatched"] == 1

    async def test_idempotent_reimport(self, db, bank_account):
        """Reimportar el mismo extracto no duplica."""
        from app.modules.finance import reconciliation
        csv = b"""Fecha,Concepto,Cargo,Abono
15/07/2026,PAGO,,1000
"""
        r1 = await reconciliation.import_statement(db, bank_account_id=bank_account.id,
                                                      file_bytes=csv, filename="e.csv")
        assert r1["imported"] == 1
        r2 = await reconciliation.import_statement(db, bank_account_id=bank_account.id,
                                                      file_bytes=csv, filename="e.csv")
        assert r2["imported"] == 0
        assert r2["duplicated"] == 1
