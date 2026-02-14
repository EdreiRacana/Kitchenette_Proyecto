from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Enum, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.db.session import Base

class StockMovementType(str, enum.Enum):
    IN = "in"
    OUT = "out"
    ADJUSTMENT = "adjustment"

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, index=True, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Simple media support for now (URLs)
    image_url = Column(String, nullable=True)
    video_url = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    variants = relationship("ProductVariant", back_populates="product", cascade="all, delete-orphan")
    media = relationship("ProductMedia", back_populates="product", cascade="all, delete-orphan")

class ProductMedia(Base):
    __tablename__ = "product_media"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    file_url = Column(String, nullable=False)
    media_type = Column(String, default="image") # image, video
    is_primary = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship("Product", back_populates="media")

class ProductVariant(Base):
    __tablename__ = "product_variants"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    sku = Column(String, unique=True, index=True, nullable=False)
    
    # Attributes
    size = Column(String, nullable=True)
    color = Column(String, nullable=True)
    material = Column(String, nullable=True)
    
    # Pricing
    price = Column(Float, nullable=False)
    cost_price = Column(Float, nullable=True) # For implementing margins later

    is_active = Column(Boolean, default=True)

    product = relationship("Product", back_populates="variants")
    stock_levels = relationship("StockLevel", back_populates="variant")

class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    location = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

class StockLevel(Base):
    __tablename__ = "stock_levels"

    id = Column(Integer, primary_key=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity = Column(Integer, default=0, nullable=False)

    variant = relationship("ProductVariant", back_populates="stock_levels")
    warehouse = relationship("Warehouse")

class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity = Column(Integer, nullable=False) # Positive or negative
    movement_type = Column(String, nullable=False) # IN, OUT, ADJUSTMENT
    reference = Column(String, nullable=True) # Order ID, Transfer ID
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Linked to Auth module if user is logged in
