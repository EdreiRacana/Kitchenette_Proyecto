from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class Notification(BaseModel):
    kind: str               # inventory | cxc | cxp | pos | hr | tax | forecast | finance
    severity: str           # info | warning | critical
    title: str
    detail: str
    page: str               # frontend module a abrir
    query: Optional[str] = None
    amount: Optional[float] = None   # monto asociado (para ordenar por impacto)
    due_date: Optional[datetime] = None
    id: Optional[str] = None          # ID estable para dismiss local


class NotificationDigest(BaseModel):
    total: int
    critical: int
    warning: int
    info: int = 0
    by_category: dict = {}
    items: List[Notification] = []


class EmailDigestResult(BaseModel):
    sent: bool
    to: str = ""
    count: int = 0
