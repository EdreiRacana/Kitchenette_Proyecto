from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.promotions import schemas, service

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


@router.post("", response_model=schemas.PromotionOut, status_code=201)
async def create_promotion(data: schemas.PromotionCreate, db: DB, current_user: CurrentUser):
    try:
        return await service.create_promotion(db, data.model_dump(), user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=List[schemas.PromotionOut])
async def list_promotions(db: DB, current_user: CurrentUser,
                           status: Optional[str] = None, limit: int = 100):
    return await service.list_promotions(db, status=status, limit=limit)


@router.get("/{promotion_id}", response_model=schemas.PromotionOut)
async def get_promotion(promotion_id: int, db: DB, current_user: CurrentUser):
    p = await service.get_promotion(db, promotion_id)
    if not p:
        raise HTTPException(status_code=404, detail="Promoción no encontrada")
    return p


@router.put("/{promotion_id}", response_model=schemas.PromotionOut)
async def update_promotion(promotion_id: int, data: schemas.PromotionUpdate,
                            db: DB, current_user: CurrentUser):
    payload = {k: v for k, v in data.model_dump().items() if v is not None}
    p = await service.update_promotion(db, promotion_id, payload)
    if not p:
        raise HTTPException(status_code=404, detail="Promoción no encontrada")
    return p


@router.post("/{promotion_id}/cancel", response_model=schemas.PromotionOut)
async def cancel_promotion(promotion_id: int, db: DB, current_user: CurrentUser):
    p = await service.cancel_promotion(db, promotion_id)
    if not p:
        raise HTTPException(status_code=404, detail="Promoción no encontrada")
    return p


@router.post("/{promotion_id}/suggestions/compute", response_model=schemas.PromotionOut)
async def compute_suggestions(promotion_id: int, db: DB, current_user: CurrentUser):
    """Calcula sugerencias de traspaso para cubrir la demanda esperada. Cada
    corrida sobrescribe las sugerencias previas no materializadas."""
    p = await service.compute_suggestions(db, promotion_id)
    if not p:
        raise HTTPException(status_code=404, detail="Promoción no encontrada")
    return p


@router.post("/{promotion_id}/suggestions/materialize")
async def materialize_suggestions(promotion_id: int, payload: schemas.MaterializePayload,
                                    db: DB, current_user: CurrentUser):
    """Materializa las sugerencias seleccionadas en StockTransfer reales,
    agrupando por (origen, destino) para minimizar folios."""
    try:
        return await service.materialize_suggestions(
            db, promotion_id, suggestion_ids=payload.suggestion_ids, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
