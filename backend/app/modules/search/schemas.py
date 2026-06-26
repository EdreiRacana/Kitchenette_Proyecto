from pydantic import BaseModel
from typing import Optional, List


class SearchResultItem(BaseModel):
    kind: str            # "customer" | "order" | "product" | "supplier" | "purchase_order" | "employee"
    id: int
    title: str
    subtitle: Optional[str] = None
    page: str            # frontend module id to navigate to
    query: str           # value to feed into that module's filter/search box


class GlobalSearchResult(BaseModel):
    customers: List[SearchResultItem] = []
    orders: List[SearchResultItem] = []
    products: List[SearchResultItem] = []
    suppliers: List[SearchResultItem] = []
    purchase_orders: List[SearchResultItem] = []
    employees: List[SearchResultItem] = []
