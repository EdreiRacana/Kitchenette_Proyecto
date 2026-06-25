import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

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
    _scheduler.start()
    logger.info("Scheduler iniciado: recordatorios de pagos programados cada 15 minutos")
