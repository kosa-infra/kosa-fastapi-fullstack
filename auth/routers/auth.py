from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.database import get_db  # ✅ DB 의존성
from auth.models import UserDB  # ✅ MySQL UserDB 모델

router = APIRouter()
templates = Jinja2Templates(directory="auth/templates")  # ✅ 상위 templates 폴더


@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})


@router.post("/register")
async def register(
    username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)
):
    # ✅ MySQL에서 username 중복 체크
    existing_user = db.query(UserDB).filter(UserDB.username == username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    # ✅ MySQL에 사용자 저장
    user = UserDB(username=username, password=password)
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
        return {"message": "User created successfully"}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username already exists")


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@router.post("/login")
async def login(
    username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)
):
    user = db.query(UserDB).filter(UserDB.username == username).first()
    if not user or user.password != password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # ✅ JavaScript fetch에서 받을 JSON 응답
    return {"isLogin": True, "username": username}
