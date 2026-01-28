import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.api.main import api_router
from app.core.database import get_db
from app.models import UserDB

# logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)-15s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = FastAPI(title="VM Provisioning API", version="1.0.0")

app.mount("/static", StaticFiles(directory="static"), name="static")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/provision")


@app.get("/")
async def root():
    return {"message": "VM Provisioning Service v1.0", "status": "ready"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/get")
async def get_data(db: Session = Depends(get_db)):
    data = db.query(UserDB).all()
    print(data)
    return data
