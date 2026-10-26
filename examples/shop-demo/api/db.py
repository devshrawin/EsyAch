"""SQLAlchemy models and session factory."""
from sqlalchemy import Column, Integer, String, Numeric, ForeignKey, DateTime, create_engine, func
from sqlalchemy.orm import declarative_base, sessionmaker

from api.config import DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)


class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    stock = Column(Integer, default=0)


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    total = Column(Numeric(10, 2))
    status = Column(String, default="pending")
    payment_intent = Column(String)
    created_at = Column(DateTime, server_default=func.now())


def get_session():
    return SessionLocal()
