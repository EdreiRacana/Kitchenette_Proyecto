import shutil
import os
from pathlib import Path
from fastapi import UploadFile
from typing import List
import uuid

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

class UploadService:
    @staticmethod
    async def save_file(file: UploadFile) -> str:
        # Generate generic unique filename
        file_extension = os.path.splitext(file.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = UPLOAD_DIR / unique_filename
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        return f"/static/{unique_filename}"

    @staticmethod
    async def save_files(files: List[UploadFile]) -> List[str]:
        urls = []
        for file in files:
            url = await UploadService.save_file(file)
            urls.append(url)
        return urls
