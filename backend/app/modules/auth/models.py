from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base

# Association table for Many-to-Many relationship between Role and Permission
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id"), primary_key=True),
)

class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    module = Column(String, nullable=False) # e.g., "inventory", "sales", "finance"
    action = Column(String, nullable=False) # e.g., "view", "edit", "admin"
    description = Column(String, nullable=True)

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    # Roles de sistema (Administrador, Solo lectura): no se eliminan ni renombran
    # — patrón estándar en ERPs de nivel mundial (SAP, NetSuite, Odoo).
    is_system = Column(Boolean, default=False, nullable=False)
    color = Column(String, nullable=True)  # color para la matriz de permisos en la UI

    permissions = relationship("Permission", secondary=role_permissions, backref="roles")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    role_obj = relationship("Role", backref="users")
    
    # Keep the legacy role string for compatibility if needed, but phase it out
    role = Column(String, default="user") # admin, manager, user
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
