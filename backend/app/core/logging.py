"""Logging estructurado para el proyecto.

En desarrollo: formato humano legible (con colores si TTY).
En producción (Render): JSON estructurado para que se pueda parsear
en herramientas como Datadog, Grafana Loki, Papertrail, etc.

Uso:
    from app.core.logging import get_logger
    log = get_logger(__name__)
    log.info("Venta registrada", extra={"order_id": 123, "total": 1500.0})
    log.error("Error en cobro", extra={"order_id": 123}, exc_info=True)

Reemplaza los print() con logger.info/warning/error. El nivel se controla
con la env var LOG_LEVEL (default INFO).
"""
import json
import logging
import os
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Serializa cada log record como una línea JSON.
    Los campos pasados como `extra=` aparecen en el JSON."""
    RESERVED = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "asctime", "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Campos extra pasados al log
        for k, v in record.__dict__.items():
            if k in self.RESERVED or k.startswith("_"):
                continue
            try:
                json.dumps(v)  # ¿serializable?
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = repr(v)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class HumanFormatter(logging.Formatter):
    """Formato humano con colores ANSI si el output es TTY."""
    COLORS = {
        "DEBUG":    "\x1b[36m",   # cyan
        "INFO":     "\x1b[32m",   # green
        "WARNING":  "\x1b[33m",   # yellow
        "ERROR":    "\x1b[31m",   # red
        "CRITICAL": "\x1b[35m",   # magenta
    }
    RESET = "\x1b[0m"

    def __init__(self, use_color: bool = True):
        super().__init__()
        self.use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).strftime("%H:%M:%S")
        color = self.COLORS.get(record.levelname, "") if self.use_color else ""
        reset = self.RESET if self.use_color else ""
        base = f"{ts} {color}{record.levelname:8s}{reset} {record.name}: {record.getMessage()}"
        # Serializar extras compactos
        extras = {}
        for k, v in record.__dict__.items():
            if k in JSONFormatter.RESERVED or k.startswith("_"):
                continue
            extras[k] = v
        if extras:
            base += " " + json.dumps(extras, default=str, ensure_ascii=False)
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


_configured = False


def configure_logging(level: str | None = None) -> None:
    """Configura logging para el proceso. Llamar una vez al arranque.

    Si LOG_LEVEL no está seteada, DEBUG en dev, INFO en producción.
    """
    global _configured
    if _configured:
        return
    lvl_str = level or os.environ.get("LOG_LEVEL")
    env = (os.environ.get("ENVIRONMENT") or "").lower()
    if not lvl_str:
        lvl_str = "DEBUG" if env in ("dev", "development", "local") else "INFO"
    lvl = getattr(logging, lvl_str.upper(), logging.INFO)

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(lvl)
    handler = logging.StreamHandler(sys.stdout)
    if env in ("production", "prod"):
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(HumanFormatter(use_color=sys.stdout.isatty()))
    root.addHandler(handler)

    # Bajar el ruido de librerías chatty
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)

    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Retorna un logger listo para usar. Idempotente."""
    if not _configured:
        configure_logging()
    return logging.getLogger(name)
