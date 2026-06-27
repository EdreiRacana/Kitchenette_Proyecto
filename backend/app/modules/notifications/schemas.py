from pydantic import BaseModel
from typing import Optional, List


class Notification(BaseModel):
    kind: str               # "inventory" | "cxc" | "cxp" | "scheduled"
    severity: str           # "info" | "warning" | "critical"
    title: str
    detail: str
    page: str               # frontend module to open
    query: Optional[str] = None


class NotificationDigest(BaseModel):
    total: int
    critical: int
    warning: int
    items: List[Notification] = []


class EmailDigestResult(BaseModel):
    sent: bool
    to: str = ""
    count: int = 0
