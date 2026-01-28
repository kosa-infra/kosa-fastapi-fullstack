from pydantic import BaseModel
from sqlalchemy import Column, Integer, String
from sqlmodel import Field

from app.core.database import Base


class UserDB(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    password = Column(String(255))


class UserCreate(BaseModel):
    username: str
    password: str


class User(BaseModel):
    id: int
    username: str

    class Config:
        from_attributes = True


class UserVMDB(Base):
    __tablename__ = "user_vm"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Field(foreign_key="users.id", nullable=False, ondelete="CASCADE")
    vmid = Column(Integer)


class UserVMCreate(BaseModel):
    user_id: int
    vmid: int


class UserVM(BaseModel):
    id: int
    user_id: int
    vmid: int

    class Config:
        from_attributes = True
