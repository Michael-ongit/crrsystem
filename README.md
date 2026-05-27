# Concrete Requisition & Reconciliation System
## Complete Production-Ready Codebase

A comprehensive enterprise-grade concrete supply management system for the Mumbai Versova Dahisar Project (MVDP), built with modern web technologies.

---

## 📋 Table of Contents

- [System Overview](#system-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
  - [Database Setup](#database-setup)
  - [Backend Setup (Python/FastAPI)](#backend-setup)
  - [Frontend Setup (React/Vite)](#frontend-setup)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Key Features](#key-features)
- [Business Logic](#business-logic)
- [Troubleshooting](#troubleshooting)

---

## 🎯 System Overview

The Concrete Requisition & Reconciliation System manages the complete lifecycle of concrete supply from requisition to reconciliation:

1. **Execution Team** → Creates concrete requisitions (location, grade, quantity)
2. **Planning Team** → Validates and approves requisitions
3. **Production Team** → Logs actual dispatch (Transit Mixer numbers, actual quantities)
4. **Dashboard** → Real-time KPI tracking and ACE limit monitoring

**Critical KPI: ACE Limit** = Maximum 1% wastage `((RequestedQTY - DispatchedQTY) / RequestedQTY)`

---

## 🛠️ Tech Stack

### Backend
- **Python 3.10+**
- **FastAPI** - Modern async web framework
- **SQLAlchemy 2.0** - ORM for database operations
- **Pydantic V2** - Data validation
- **PyODBC** - MS SQL Server connectivity
- **Uvicorn** - ASGI server

### Frontend
- **React 18.2** - UI library
- **TypeScript** - Strict typing
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first styling
- **React Router v6** - Client-side routing
- **React Hook Form** - Form state management
- **Axios** - HTTP client
- **Recharts** - Data visualization

### Database
- **Microsoft SQL Server** - Relational database

---

## 📁 Project Structure

```
c:\Michael\L_T internship\concrete_recon\
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── config.py              # Configuration & settings
│   ├── database.py            # SQLAlchemy setup
│   ├── models.py              # ORM models
│   ├── schemas.py             # Pydantic schemas
│   ├── main.py                # FastAPI app entry point
│   └── routers/
│       ├── __init__.py
│       ├── requisitions.py    # Requisition endpoints
│       ├── production.py      # Dispatch endpoints
│       └── dashboard.py       # Analytics endpoints
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api.ts             # Axios setup & endpoints
│       ├── types.ts           # TypeScript interfaces
│       ├── index.css
│       ├── pages/
│       │   ├── ExecutionView.tsx
│       │   ├── PlanningView.tsx
│       │   ├── ProductionView.tsx
│       │   └── ReconciliationDashboard.tsx
│       └── components/
│           └── Layout.tsx
└── README.md
```

---

## 🚀 Installation & Setup

### Prerequisites

- **Python 3.10+** - [Download](https://www.python.org/downloads/) (tested with Python 3.14)
- **Node.js 18+** - [Download](https://nodejs.org/)
- **Microsoft SQL Server** - [SSMS](https://learn.microsoft.com/en-us/sql/ssms/download-sql-server-management-studio-ssms)
- **Git** - Version control
- **VS Code** - Code editor

### Database Setup

#### 1. Create MS SQL Server Database

```sql
-- In SQL Server Management Studio (SSMS)

-- Create database
CREATE DATABASE MVDP_DB;
GO

-- Use the database
USE MVDP_DB;
GO

-- Create tables (SQLAlchemy will do this automatically on app startup)
-- But you can pre-create them manually if needed

-- Check if tables exist
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_TYPE = 'BASE TABLE';
```

#### 2. Verify ODBC Driver

```powershell
# In PowerShell - Check for ODBC Driver 17 for SQL Server
Get-OdbcDriver | Select-Object Name
```

If not installed, download from [Microsoft ODBC Driver 17 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)

### Backend Setup

#### 1. Navigate to Backend Directory

```powershell
cd "c:\Michael\L_T internship\concrete_recon\backend"
```

#### 2. Create Python Virtual Environment

```powershell
# Windows PowerShell
python -m venv venv
.\venv\Scripts\Activate.ps1

# If you get execution policy error:
# Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### 3. Install Python Dependencies

```powershell
pip install -r requirements.txt
```

#### 4. Configure Environment Variables

```powershell
# Copy example to .env
Copy-Item .env.example .env

# Edit .env if needed
notepad .env
```

**Example .env:**
```
DATABASE_BACKEND=sqlite
SQLITE_DATABASE_PATH=mvdp_dev.db
CORS_ORIGINS=["http://localhost:5090", "http://127.0.0.1:5090"]
ACE_LIMIT_PERCENT=1.0
```

The default local database is created automatically at `backend\mvdp_dev.db`,
so SSMS and SQL Server are not required for development.

**Optional SQL Server .env:**
```env
DATABASE_BACKEND=mssql
DATABASE_DRIVER=ODBC Driver 17 for SQL Server
DATABASE_SERVER=localhost\SQLEXPRESS
DATABASE_NAME=MVDP_DB
DATABASE_USER=SQLuser1
DATABASE_PASSWORD=SQLuser1
```

**Common Database Server Values:**
- Local: `localhost` or `127.0.0.1`
- Named instance: `localhost\SQLEXPRESS` or `COMPUTERNAME\SQLEXPRESS`
- Network: `SERVER_IP\INSTANCE`

#### 5. Verify Database Connection

```powershell
cd "c:\Michael\L_T internship\concrete_recon\backend"
.\venv\Scripts\python.exe -c "from sqlalchemy import text; from database import engine; conn = engine.connect(); print(conn.execute(text('SELECT 1')).scalar()); conn.close(); print('Connection successful!')"
```

If this fails with `Named Pipes Provider` or `Login timeout expired`, check that
`backend\.env` is using SQLite for local development:

```env
DATABASE_BACKEND=sqlite
SQLITE_DATABASE_PATH=mvdp_dev.db
```

#### 6. Create Initial Test User (Optional)

```powershell
python
>>> from database import SessionLocal, init_db
>>> from models import User, UserRole
>>> from routers.auth import hash_password
>>> init_db()  # Creates all tables
>>> 
>>> db = SessionLocal()
>>> user = User(
...     name="Demo User",
...     email="demo@mvdp.com",
...     role=UserRole.EXECUTION,
...     password_hash=hash_password("DemoPass123"),
...     is_email_verified=True,
... )
>>> db.add(user)
>>> db.commit()
>>> print(f"User created: {user.id}")
>>> db.close()
>>> exit()
```

### Frontend Setup

#### 1. Navigate to Frontend Directory

```powershell
cd "c:\Michael\L_T internship\concrete_recon\frontend"
```

#### 2. Install Node Dependencies

```powershell
npm install
```

#### 3. Verify Tailwind CSS is Working (Optional)

```powershell
npm run build
```

---

## ⚙️ Configuration

### Backend Configuration (`config.py`)

Key settings:
- `DATABASE_URL` - MS SQL connection string
- `CORS_ORIGINS` - Allowed frontend URLs
- `ACE_LIMIT_PERCENT` - Wastage threshold (1%)
- `API_TITLE`, `API_VERSION` - Metadata

### Frontend Configuration (`vite.config.ts`)

Key settings:
- `port: 5090` - Dev server port
- `proxy` - Backend API proxy route
- `build.outDir` - Build output directory

---

## 🏃 Running the Application

Run these commands from two separate PowerShell terminals during development.

### Terminal 1: Start Backend (FastAPI)

```powershell
cd "c:\Michael\L_T internship\concrete_recon\backend"

# Activate virtual environment
.\venv\Scripts\Activate.ps1

# Start server
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8020
```

**Expected Output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8020
INFO:     Application startup complete
```

Access API docs at: **http://localhost:8020/docs**

### Terminal 2: Start Frontend (Vite)

```powershell
cd "c:\Michael\L_T internship\concrete_recon\frontend"
npm run dev
```

**Expected Output:**
```
  ➜  Local:   http://localhost:5090/
```

Open **http://localhost:5090** in your browser.

### Quick Development Checks

Use these when the terminal shows an error and you want to verify each side independently:

```powershell
# Backend import check
cd "c:\Michael\L_T internship\concrete_recon"
backend\venv\Scripts\python.exe -c "import sys; sys.path.insert(0, 'backend'); import main; print('backend import ok')"

# Backend database check
cd "c:\Michael\L_T internship\concrete_recon\backend"
.\venv\Scripts\python.exe -c "from sqlalchemy import text; from database import engine; conn = engine.connect(); print(conn.execute(text('SELECT 1')).scalar()); conn.close()"

# Frontend production build check
cd "c:\Michael\L_T internship\concrete_recon\frontend"
npm run build
```

---

## 📚 API Documentation

### Base URL: `http://localhost:8020`

### Authentication Endpoints

#### Create User
```bash
POST /users
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@mvdp.com",
  "role": "Execution"  # Execution, Planning, Production, Admin
}
```

#### Get All Users
```bash
GET /users
```

### Requisition Endpoints

#### Preview Generated Supply ID
```bash
GET /requisitions/supply-id/preview?location=Foundation%20-%20Pier%20A&structure_name=Pier-01&structure_id=STR-001

# Response:
{
  "supply_id": "MVDP-FOUPI-PIE01-STR001-260508-001",
  "pattern": "MVDP-{site}-{structure}-{structure_id}-{YYMMDD}-{sequence}"
}
```

#### Create Requisition
```bash
POST /requisitions
Content-Type: application/json

{
  "location": "Foundation - Pier A",
  "in_charge_id": "550e8400-e29b-41d4-a716-446655440000",
  "structure_name": "Pier-01",
  "structure_id": "STR-001",
  "grade": "M40",
  "requested_qty": 50.5,
  "placement_by": "Site Engineer Name"
}

# Response:
{
  "supply_id": "MVDP-FOUPI-PIE01-STR001-260508-001",
  "status": "Pending",
  "requested_qty": 50.5,
  ...
}
```

#### Get Requisitions
```bash
GET /requisitions?status_filter=Pending

# Response: Array of requisitions
```

#### Validate Requisition
```bash
PUT /requisitions/MVDP-FOUPI-PIE01-STR001-260508-001/validate
Content-Type: application/json

{
  "validated_by": "550e8400-e29b-41d4-a716-446655440001",
  "planning_remarks": "Approved for production",
  "is_approved": "Approved"  # Approved, Rejected, Pending
}
```

### Production Endpoints

#### Log Dispatch
```bash
POST /production/dispatch
Content-Type: application/json

{
  "supply_id": "MVDP-FOUPI-PIE01-STR001-260508-001",
  "tm_number": "TM-001",
  "actual_dispatched_qty": 49.8,
  "dispatch_time": "2026-05-05T14:30:00Z",
  "delivery_time": "2026-05-05T16:45:00Z"
}

# Response includes calculated wastage
```

#### Get Dispatches by Supply
```bash
GET /production/dispatch/MVDP-FOUPI-PIE01-STR001-260508-001
```

#### Update Delivery Time
```bash
PUT /production/dispatch/{dispatch_id}/delivery
Content-Type: application/json

{
  "delivery_time": "2026-05-05T16:45:00Z"
}
```

### Dashboard Endpoints

#### Get Dashboard Summary
```bash
GET /dashboard/summary?days=30

# Response:
{
  "total_requisitions": 42,
  "pending_count": 5,
  "validated_count": 15,
  "dispatched_count": 20,
  "reconciled_count": 2,
  "average_wastage_percentage": 0.82,
  "violation_count": 3,
  "wastage_records": [...],
  "turnaround_records": [...]
}
```

#### Get Wastage Records
```bash
GET /dashboard/wastage?days=30&exceeds_limit_only=false
```

#### Get Turnaround Times
```bash
GET /dashboard/turnaround?days=30
```

### Interactive API Docs

- **Swagger UI:** http://localhost:8020/docs
- **ReDoc:** http://localhost:8020/redoc

---

## 🔑 Key Features

### 1. Role-Based Access Control
- **Execution:** Create requisitions
- **Planning:** Validate/reject requisitions
- **Production:** Log dispatches
- **Admin:** Dashboard + all permissions

### 2. Strict Business Logic
```python
# ACE Limit Calculation
wastage_qty = requested_qty - actual_dispatched_qty
wastage_pct = (wastage_qty / requested_qty) * 100

# Flag if exceeds 1%
if wastage_pct > 1.0:
    log_violation(supply_id, wastage_pct)
```

### 3. Form Validation
- React Hook Form on frontend
- Pydantic V2 on backend
- Type-safe TypeScript interfaces

### 4. Real-Time Dashboard
- Wastage tracking with ACE limit line reference
- TM turnaround time analytics
- Status breakdown charts
- Violation alerts

### 5. CORS Configuration
```python
# Backend allows frontend to make requests
# UPDATE in config.py if frontend URL changes:
CORS_ORIGINS = [
    "http://localhost:5090",  # Local dev
    "https://yourproduction.com"  # Production
]
```

---

## 📊 Business Logic

### Workflow

```
[Execution]                [Planning]              [Production]        [Dashboard]
    |                          |                        |                  |
    v                          v                        v                  v
CREATE REQUISITION → VALIDATE REQUISITION → LOG DISPATCH → ANALYZE WASTAGE
Pending                 Validated               Dispatched         KPI Tracking

Status Flow:
Pending → Validated → Dispatched → Reconciled
```

### Critical Calculations

**Wastage Percentage:**
```
Wastage % = ((Requested QTY - Dispatched QTY) / Requested QTY) * 100
```

**ACE Limit Violation:**
```
If Wastage % > 1.0% → FLAG AS VIOLATION ⚠️
```

**TM Turnaround Time:**
```
Turnaround Hours = (Delivery Time - Dispatch Time) / 3600 seconds
```

### Generated SupplyID Format

```
MVDP-FOUPI-PIE01-STR001-260508-001
 |     |     |      |      |      |
 |     |     |      |      |      Sequence for that site/structure/day
 |     |     |      |      Date code (YYMMDD)
 |     |     |      Structure ID token
 |     |     Structure name token
 |     Site location token
 Project code
```

Supply IDs are generated by the backend when a requisition is created. The
frontend can preview the next ID, but users do not type or edit it.

---

## 🔧 Troubleshooting

### Backend Issues

#### 1. Database Connection Error
```
Error: "Failed to create database engine"
```

**Solution:**
```bash
# Check SQL Server is running (Windows)
Get-Service "MSSQLSERVER" | Start-Service

# Verify credentials in .env
# Test connection:
python -c "from database import engine; print(engine.url)"
```

#### 2. ODBC Driver Not Found
```
Error: "[IM002] [Microsoft][ODBC Driver Manager] Data source name not found"
```

**Solution:**
1. Check installed drivers: `Get-OdbcDriver`
2. Install ODBC Driver 17: https://go.microsoft.com/fwlink/?linkid=2223814
3. Restart application after installation

#### 3. Port Already in Use
```
Error: "Address already in use"
```

**Solution:**
```bash
# Find process using port 8020
netstat -ano | findstr :8020

# Kill process (replace 12345 with PID)
taskkill /pid 12345 /f

# Or use different port
python -m uvicorn main:app --port 8001
```

### Frontend Issues

#### 1. Module Not Found
```
Error: "Cannot find module 'react'"
```

**Solution:**
```bash
cd frontend
npm install
npm run dev
```

#### 2. API Calls Failing (CORS)
```
Error: "Access to XMLHttpRequest blocked by CORS"
```

**Solution:**
1. Verify backend is running on port 8020
2. Check backend `config.py` CORS settings
3. Check frontend `vite.config.ts` proxy settings
4. Update `config.py` CORS_ORIGINS if frontend URL changed

#### 3. Port 5090 Already in Use
```
Error: "Port 5090 in use"
```

**Solution:**
```bash
# Use different port
npm run dev -- --port 5174
```

### Database Issues

#### 1. Tables Not Created
```
Error: "Invalid object name 'concrete_requisitions'"
```

**Solution:**
```bash
python
>>> from database import init_db
>>> init_db()
>>> exit()
```

#### 2. Authentication Fails
```
Error: "Login failed for user 'sa'"
```

**Solution:**
- Verify SQL Server username/password in .env
- Default SA password might be empty (try `""` in .env)
- Check SQL Server authentication mode: Windows vs Mixed

---

## 📝 Environment Variables Reference

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_DRIVER` | `ODBC Driver 17 for SQL Server` | ODBC driver name |
| `DATABASE_SERVER` | `localhost\SQLEXPRESS` or `.\SQLEXPRESS` | Server address |
| `DATABASE_NAME` | `MVDP_DB` | Database name |
| `DATABASE_USER` | `sa` | SQL Server user |
| `DATABASE_PASSWORD` | `Strong@Pass123` | SQL Server password |
| `CORS_ORIGINS` | `["http://localhost:5090"]` | Allowed frontend URLs |
| `ACE_LIMIT_PERCENT` | `1.0` | Wastage threshold % |

---

## 🧪 Testing

### Manual API Testing

```bash
# 1. Create user
curl -X POST http://localhost:8020/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@mvdp.com","role":"Execution"}'

# 2. Get all users
curl http://localhost:8020/users

# 3. Preview generated Supply ID
curl "http://localhost:8020/requisitions/supply-id/preview?location=Test%20Location&structure_name=Test&structure_id=str-001"

# 4. Create requisition. Do not send supply_id; the backend generates it.
curl -X POST http://localhost:8020/requisitions \
  -H "Content-Type: application/json" \
  -d '{
    "location":"Test Location",
    "in_charge_id":"550e8400-e29b-41d4-a716-446655440000",
    "structure_name":"Test",
    "structure_id":"str-001",
    "grade":"M40",
    "requested_qty":50.5
  }'
```

---

## 📦 Deployment

### Production Build

#### Backend
```bash
# Install dependencies
pip install -r requirements.txt

# Run with production server
python -m gunicorn -w 4 -b 0.0.0.0:8020 main:app
```

#### Frontend
```bash
# Build optimized production files
npm run build

# Serve static files from dist/ folder
```

### Environment Configuration for Production

Update `.env`:
```
DATABASE_SERVER=prod-db-server.com
DATABASE_USER=prod_user
DATABASE_PASSWORD=StrongProductionPassword123!
CORS_ORIGINS=["https://yourdomain.com"]
```

---

## 📞 Support & Contact

For issues or questions:
1. Check the **Troubleshooting** section
2. Review **API Documentation**
3. Check application logs (console output)
4. Verify database connection and permissions

---

## 📄 License

Internal project - Mumbai Versova Dahisar Project (MVDP)

---

## 🎉 Ready to Go!

Once setup is complete:
1. ✅ Backend API running on http://localhost:8020
2. ✅ Interactive API docs on http://localhost:8020/docs
3. ✅ Frontend application on http://localhost:5090
4. ✅ Database connected and initialized

**Start using the system!**
- Go to http://localhost:5090
- Switch roles in the demo
- Create requisitions, validate, dispatch, and monitor KPIs

---

**Last Updated:** May 5, 2026  
**Version:** 1.0.0  
**Status:** Production Ready
