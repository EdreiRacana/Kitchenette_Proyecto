from fastapi import UploadFile
from typing import List

from app.core.storage import upload_bytes


class UploadService:
    @staticmethod
    async def save_file(file: UploadFile) -> str:
        content = await file.read()
        return await upload_bytes(content, file.filename or "archivo", folder="misc")

    @staticmethod
    async def save_files(files: List[UploadFile]) -> List[str]:
        urls = []
        for file in files:
            url = await UploadService.save_file(file)
            urls.append(url)
        return urls
