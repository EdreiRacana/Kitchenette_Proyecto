from sqlalchemy import Column, String, Boolean, Enum, Integer, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import relationship
import enum
import uuid
from app.db.session import Base

class IntegrationProvider(str, enum.Enum):
    STRIPE = "STRIPE"
    MERCADO_PAGO = "MERCADO_PAGO"
    AWS_S3 = "AWS_S3"
    SENDGRID = "SENDGRID"
    SAT_FACTURACION = "SAT_FACTURACION"
    OTHER = "OTHER"

class IntegrationType(str, enum.Enum):
    PAYMENT_GATEWAY = "PAYMENT_GATEWAY"
    EMAIL = "EMAIL"
    STORAGE = "STORAGE"
    ACCOUNTING = "ACCOUNTING"
    OTHER = "OTHER"

class IntegrationEnvironment(str, enum.Enum):
    SANDBOX = "SANDBOX"
    PRODUCTION = "PRODUCTION"

class CompanyProfile(Base):
    __tablename__ = "company_profile"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    legal_name = Column(String, nullable=False)
    tax_id = Column(String, nullable=True)  # RFC or NIF
    contact_email = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    base_currency = Column(String, default="MXN")
    timezone = Column(String, default="America/Mexico_City")
    logo_url = Column(String, nullable=True)


class Branch(Base):
    """Sucursal / empresa operativa. Primer nivel del modelo multi-empresa
    (estilo company code de SAP / subsidiary de NetSuite). Almacenes y usuarios
    se asignan a una sucursal; el aislamiento de datos se construye por capas
    encima de este cimiento."""
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)            # nombre comercial / corto
    code = Column(String, nullable=True, index=True)  # clave corta (ej. CDMX, MTY)
    legal_name = Column(String, nullable=True)       # razón social
    tax_id = Column(String, nullable=True)           # RFC
    address = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)  # matriz
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SystemIntegration(Base):
    __tablename__ = "system_integrations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    provider_name = Column(Enum(IntegrationProvider), nullable=False)
    integration_type = Column(Enum(IntegrationType), nullable=False)
    is_active = Column(Boolean, default=False)
    environment = Column(Enum(IntegrationEnvironment), default=IntegrationEnvironment.SANDBOX)
    
    # Encrypted in production ideally, plain text here for MVP unless specified otherwise
    api_key = Column(String, nullable=True)
    api_secret = Column(String, nullable=True)
    webhook_secret = Column(String, nullable=True)
    
    # For extra settings unique to an API
    meta_data = Column(JSON, nullable=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    user_id = Column(Integer, nullable=True) # Linked to Users table
    action = Column(String, nullable=False) # e.g. "UPDATE_PRODUCT", "DELETE_SALE"
    module = Column(String, nullable=False) # e.g. "inventory", "sales"
    description = Column(String, nullable=True)
    details = Column(JSON, nullable=True) # Old vs New values
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
