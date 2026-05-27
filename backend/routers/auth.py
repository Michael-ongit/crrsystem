# routers/auth.py - Development registration and login endpoints
from datetime import timedelta
import hashlib
import hmac
import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import AuthSession, User, UserRole
from schemas import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    UserResponse,
    MessageResponse,
)
from time_utils import now_ist

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"pbkdf2_sha256$120000${salt}${digest.hex()}"


def _verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False

    try:
        algorithm, iterations, salt, expected = stored_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations),
    )
    return hmac.compare_digest(digest.hex(), expected)


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    token = authorization.split(" ", 1)[1].strip()
    session = (
        db.query(AuthSession)
        .filter(
            AuthSession.token_hash == _hash_token(token),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now_ist(),
        )
        .first()
    )

    if not session or not session.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )

    return session.user


def require_roles(*roles: UserRole):
    """FastAPI dependency factory for role-restricted endpoints."""
    allowed_roles = set(roles)

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return role_checker


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a development user",
)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
    try:
        existing_user = db.query(User).filter(User.email == payload.email).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email already exists. Switch to Login or use another email.",
            )

        user = User(
            name=payload.name,
            email=payload.email,
            role=UserRole(payload.role.value),
            password_hash=hash_password(payload.password),
            is_email_verified=True,
        )

        db.add(user)
        db.commit()
        db.refresh(user)

        return RegisterResponse(
            message="Registration successful. You can now log in.",
            email=payload.email,
        )
    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists. Switch to Login or use another email.",
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Registration failed for %s", payload.email)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {exc.__class__.__name__}. Check backend logs for details.",
        )


@router.post("/login", response_model=AuthResponse, summary="Log in with email and password")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = secrets.token_urlsafe(40)
    expires_at = now_ist() + timedelta(days=settings.AUTH_SESSION_DAYS)
    session = AuthSession(user_id=user.id, token_hash=_hash_token(token), expires_at=expires_at)

    user.last_login_at = now_ist()
    db.add(session)
    db.commit()
    db.refresh(user)

    return AuthResponse(access_token=token, expires_at=expires_at, user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse, summary="Get current authenticated user")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout", response_model=MessageResponse, summary="Revoke current session")
def logout(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        session = db.query(AuthSession).filter(AuthSession.token_hash == _hash_token(token)).first()
        if session:
            session.revoked_at = now_ist()
            db.commit()

    return MessageResponse(message="Logged out successfully")
