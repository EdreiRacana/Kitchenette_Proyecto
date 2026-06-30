"""Elimina líneas de devolución con artículos de demo/seed que no corresponden
a un cliente real (ej. materiales de construcción registrados por error en
clientes como Liverpool: "Cemento gris CPC 30R", "Pintura vinílica 19L",
"Varilla 3/8", "Tubo PVC 4").

Uso (desde backend/, con DATABASE_URL apuntando a la base real):

    python -m scripts.cleanup_stale_returns                  # dry-run, solo lista
    python -m scripts.cleanup_stale_returns --apply           # borra de verdad
    python -m scripts.cleanup_stale_returns --apply --customer "Liverpool"

Si una devolución se queda sin partidas tras la limpieza, también se borra el
encabezado (CustomerReturn) completo. Si quedan partidas, se recalcula
refund_amount como la suma de los subtotales restantes.
"""

import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.modules.sales import models as sales_models
from app.modules.customers import models as cust_models

STALE_KEYWORDS = [
    "cemento", "pintura vinílica", "pintura vinilica", "varilla", "tubo pvc",
]


async def run(apply: bool, customer_filter: str | None) -> None:
    async with AsyncSessionLocal() as db:  # type: AsyncSession
        stmt = select(sales_models.CustomerReturnItem)
        if customer_filter:
            stmt = stmt.join(sales_models.CustomerReturn).join(
                cust_models.Customer, sales_models.CustomerReturn.customer_id == cust_models.Customer.id
            ).where(cust_models.Customer.name.ilike(f"%{customer_filter}%"))
        rows = (await db.execute(stmt)).scalars().all()

        matches = [
            it for it in rows
            if it.product_name and any(k in it.product_name.lower() for k in STALE_KEYWORDS)
        ]

        if not matches:
            print("No se encontraron líneas de devolución con artículos de demo.")
            return

        print(f"Encontradas {len(matches)} líneas sospechosas:")
        affected_returns: dict[int, sales_models.CustomerReturn] = {}
        for it in matches:
            print(f"  - return_item #{it.id} · return_id={it.return_id} · {it.product_name} · qty={it.quantity} · ${it.subtotal}")

        if not apply:
            print("\nDry-run: no se borró nada. Vuelve a ejecutar con --apply para eliminar.")
            return

        for it in matches:
            ret = await db.get(sales_models.CustomerReturn, it.return_id)
            if ret:
                affected_returns[ret.id] = ret
            await db.delete(it)
        await db.flush()

        for ret_id, ret in affected_returns.items():
            rres = await db.execute(
                select(sales_models.CustomerReturnItem).where(sales_models.CustomerReturnItem.return_id == ret_id)
            )
            remaining = rres.scalars().all()
            if not remaining:
                print(f"  return #{ret_id} sin partidas restantes → eliminando encabezado")
                await db.delete(ret)
            else:
                ret.refund_amount = sum(r.subtotal or 0 for r in remaining)
                print(f"  return #{ret_id} actualizado · refund_amount={ret.refund_amount}")

        await db.commit()
        print(f"\nListo: {len(matches)} líneas eliminadas, {len(affected_returns)} devoluciones revisadas.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Ejecuta el borrado (sin esto solo es dry-run)")
    parser.add_argument("--customer", default=None, help="Filtra por nombre de cliente (ej. Liverpool)")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply, customer_filter=args.customer))
