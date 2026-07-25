import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.session import AsyncSessionLocal

logger = logging.getLogger("uvicorn.error")

_scheduler = AsyncIOScheduler()


async def _run_scheduled_payment_reminders():
    from app.modules.finance import service as finance_service

    async with AsyncSessionLocal() as db:
        try:
            await finance_service.process_due_scheduled_payments(db)
            sent = await finance_service.send_scheduled_payment_reminders(db)
            if sent:
                logger.info("Recordatorios de pagos programados enviados: %s", sent)
        except Exception:
            logger.exception("Error ejecutando el job de recordatorios de pagos programados")


async def _run_daily_birthday_emails():
    """Correos automáticos de cumpleaños. Corre a las 9:00 UTC (≈ 3:00 AM
    hora CDMX) para que los cumpleañeros abran el correo en la mañana.
    Solo actúa si el programa de fidelidad está activo y birthday_email_enabled=True."""
    from app.modules.customers import loyalty_service
    async with AsyncSessionLocal() as db:
        try:
            res = await loyalty_service.send_birthday_emails(db)
            if res.get("sent"):
                logger.info("Correos de cumpleaños enviados: %s", res)
        except Exception:
            logger.exception("Error ejecutando el job diario de cumpleaños")


async def _run_nightly_tier_recompute():
    """Recomputa todos los tiers una vez al día (3:30 UTC). Complementa el
    recompute_on_each_sale para arrastrar a los clientes cuyo ventana se
    corrió (perdieron gasto de hace N meses sin comprar recientemente)."""
    from app.modules.customers import loyalty_service
    async with AsyncSessionLocal() as db:
        try:
            cfg = await loyalty_service.get_program_config(db)
            if not cfg.is_enabled:
                return
            res = await loyalty_service.recompute_all_tiers(db)
            logger.info("Recalculo nightly de tiers: %s", res)
        except Exception:
            logger.exception("Error ejecutando el recompute nightly de tiers")


def start_scheduler():
    if _scheduler.running:
        return
    _scheduler.add_job(
        _run_scheduled_payment_reminders,
        "interval",
        minutes=15,
        id="scheduled_payment_reminders",
        replace_existing=True,
    )
    # Cumpleaños: 9:00 UTC ≈ 3:00 AM CDMX — el correo llega temprano.
    _scheduler.add_job(
        _run_daily_birthday_emails,
        CronTrigger(hour=9, minute=0),
        id="loyalty_birthday_emails",
        replace_existing=True,
    )
    # Tiers nightly: 9:30 UTC ≈ 3:30 AM CDMX — después de cumpleaños.
    _scheduler.add_job(
        _run_nightly_tier_recompute,
        CronTrigger(hour=9, minute=30),
        id="loyalty_tier_recompute",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Scheduler iniciado: recordatorios pagos (15m), cumpleaños (09:00 UTC), tiers (09:30 UTC)")
