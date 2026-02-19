from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.modules.auth.models import User
from app.modules.auth.schemas import UserCreate
from app.core.security import get_password_hash, verify_password

async def get_user_by_email(db: AsyncSession, email: str):
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()

async def create_user(db: AsyncSession, user_in: UserCreate):
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name,
        role=user_in.role,
        is_active=user_in.is_active,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

async def authenticate_user(db: AsyncSession, email: str, password: str):
    print(f"DEBUG: authenticate_user called for {email}")
    user = await get_user_by_email(db, email)
    if not user:
        print(f"DEBUG: User '{email}' NOT FOUND in database query.")
        return False
    
    print(f"DEBUG: User found: {user.email}. ID: {user.id}. Hashed Pwd in DB: {user.hashed_password[:10]}...")
    
    if not verify_password(password, user.hashed_password):
        print("DEBUG: Password verification FAILED.")
        return False
        
    print("DEBUG: Password verification SUCCESS.")
    return user
