from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from auth.database import engine
from auth.models import Base
from auth.routers.auth import router as auth_router

app = FastAPI()
templates = Jinja2Templates(directory="auth/templates")

app.mount("/static", StaticFiles(directory="auth/static"), name="static")

app.include_router(auth_router, prefix="/auth", tags=["auth"])
Base.metadata.create_all(bind=engine)


@app.get("/")
async def root():
    return {"message": "FastAPI User Management with MySQL Config"}
