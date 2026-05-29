# main.py - FastAPI application entry point for MVDP System
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
import logging

from config import settings
from database import init_db, get_db, SessionLocal
from models import User, UserRole
from schemas import UserCreate, UserResponse
from routers import admin, auth, requisitions, production, dashboard

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    description="Complete concrete requisition, validation, production, and reconciliation system for MVDP",
    version=settings.API_VERSION,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info(f"CORS enabled for origins: {settings.CORS_ORIGINS}")


# ============== EXCEPTION HANDLERS ==============

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    """Handle Pydantic validation errors"""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


# ============== HEALTH CHECK ==============

@app.get(
    "/health",
    tags=["Health"],
    summary="Health check endpoint",
    description="Verify API is running and database connection is active."
)
async def health_check():
    """Basic health check endpoint"""
    try:
        # Test database connection
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return {
            "status": "healthy",
            "database": "connected",
            "version": settings.API_VERSION
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection failed"
        )


# ============== USER MANAGEMENT ENDPOINTS ==============

@app.post(
    "/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Users"],
    summary="Create a new user",
    description="Create a new system user with assigned role."
)
async def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.require_roles(UserRole.ADMIN))
):
    """
    Create a new user.
    
    - **name**: Full name of the user
    - **email**: Unique email address
    - **role**: One of [Execution, Planning, Production, Admin]
    """
    try:
        # Check if email already exists
        existing_user = db.query(User).filter(User.email == user.email).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"User with email '{user.email}' already exists"
            )
        
        # Create new user
        db_user = User(
            name=user.name,
            email=user.email,
            role=UserRole(user.role.value),
            password_hash=auth.hash_password(user.password),
            is_email_verified=True
        )
        db_user.assigned_locations = user.assigned_locations
        
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        
        logger.info(f"User created: {user.email} with role {user.role}")
        return db_user
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating user: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create user"
        )


@app.get(
    "/users",
    response_model=list[UserResponse],
    tags=["Users"],
    summary="Get all users"
)
async def get_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user)
):
    """Retrieve all system users"""
    try:
        users = db.query(User).all()
        return users
    except Exception as e:
        logger.error(f"Error fetching users: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch users"
        )


@app.get(
    "/users/{user_id}",
    response_model=UserResponse,
    tags=["Users"],
    summary="Get user by ID"
)
async def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user)
):
    """Get a specific user by ID"""
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with id '{user_id}' not found"
            )
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch user"
        )


# ============== REGISTER ROUTERS ==============

# Include routers with prefixes
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(requisitions.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(production.router, dependencies=[Depends(auth.get_current_user)])
app.include_router(dashboard.router, dependencies=[Depends(auth.get_current_user)])

logger.info("All routers registered successfully")


# ============== STARTUP AND SHUTDOWN EVENTS ==============

@app.on_event("startup")
async def startup_event():
    """Initialize database and log startup"""
    logger.info("=" * 80)
    logger.info("MVDP CONCRETE RECONCILIATION SYSTEM - STARTUP")
    logger.info("=" * 80)
    logger.info(f"API Title: {settings.API_TITLE}")
    logger.info(f"API Version: {settings.API_VERSION}")
    logger.info(f"Database: {settings.DATABASE_BACKEND} ({settings.DATABASE_URL})")
    logger.info(f"ACE Limit (Wastage): {settings.ACE_LIMIT_PERCENT}%")
    logger.info("=" * 80)
    
    try:
        init_db()
        logger.info("Database initialization completed successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """Log shutdown"""
    logger.info("MVDP System shutting down...")
    logger.info("=" * 80)


# ============== ROOT ENDPOINT ==============

@app.get(
    "/",
    tags=["Info"],
    summary="API information"
)
async def root():
    """Root endpoint with API information"""
    return {
        "name": settings.API_TITLE,
        "version": settings.API_VERSION,
        "description": "Complete concrete requisition, validation, production, and reconciliation system",
        "documentation": "/docs",
        "status": "operational"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8020,
        log_level="info"
    )
