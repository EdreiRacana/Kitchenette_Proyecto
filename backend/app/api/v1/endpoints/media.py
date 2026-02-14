from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List, Annotated
from app.api import deps
from app.modules.auth.models import User
from app.core.upload import UploadService

router = APIRouter()

@router.post("/upload", response_model=List[str])
async def upload_files(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(deps.get_current_active_user)
):
    """
    Upload one or multiple files. Returns a list of URLs.
    """
    try:
        urls = await UploadService.save_files(files)
        return urls
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not upload files: {str(e)}")
