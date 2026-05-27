# QUICK START GUIDE - MVDP Concrete Reconciliation System

## ⚡ 5-Minute Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- Microsoft SQL Server
- VS Code

---

## 🗄️ Step 1: Database Setup (2 min)

### In SQL Server Management Studio:
```sql
CREATE DATABASE MVDP_DB;
```

---

## 🐍 Step 2: Backend Setup (2 min)

### PowerShell Terminal:
```bash
cd "c:\Michael\L&T internship\backend"

# Create virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Copy and edit configuration
Copy-Item .env.example .env
# Edit .env with your SQL Server credentials
```

### Edit `backend\.env`:
```
DATABASE_SERVER=localhost
DATABASE_NAME=MVDP_DB
DATABASE_USER=sa
DATABASE_PASSWORD=YourPassword
```

### Start Backend (in same terminal):
```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8020
```

✅ **Backend running at:** http://localhost:8020
✅ **API Docs at:** http://localhost:8020/docs

---

## ⚛️ Step 3: Frontend Setup (1 min)

### New PowerShell Terminal:
```bash
cd "c:\Michael\L&T internship\frontend"

npm install
npm run dev
```

✅ **Frontend running at:** http://localhost:5090

---

## 🎬 That's It!

Open your browser: **http://localhost:5090**

### Demo Features:
1. **Execution View** - Create concrete requisitions
2. **Planning View** - Validate/approve requisitions
3. **Production View** - Log dispatch with Transit Mixer details
4. **Dashboard** - Real-time KPI tracking & ACE limit monitoring

---

## 🔄 Testing Workflow

### 1. Create Requisition (Execution View)
- Supply ID: `MVDP/GIC/Per/Pier/001`
- Location: `Foundation - Pier A`
- Grade: `M40`
- Quantity: `50.5 m³`

### 2. Validate Requisition (Planning View)
- Select the requisition
- Click "Review"
- Choose "Approved"
- Submit

### 3. Log Dispatch (Production View)
- Select validated order
- Enter TM-001, 49.8 m³
- Log dispatch time
- Watch wastage calculation (0.82%)

### 4. View Dashboard
- Check KPIs: 1 requisition, 0.82% wastage
- Verify ACE limit compliance
- See turnaround times

---

## 🆘 Quick Troubleshooting

### Backend won't start?
```bash
# Check SQL Server running
Get-Service "MSSQLSERVER" | Start-Service

# Test database
python -c "from database import init_db; init_db()"
```

### Frontend shows "Cannot connect to API"?
```bash
# Verify backend is running on port 8020
netstat -ano | findstr :8020

# Check CORS in backend/config.py
```

### Port already in use?
```bash
# Use different port
python -m uvicorn main:app --port 8001
# OR
npm run dev -- --port 5174
```

---

## 📚 Full Documentation

See **[README.md](./README.md)** for complete setup instructions, API details, and troubleshooting.

---

## 🎯 Key Files to Remember

| Location | Purpose |
|----------|---------|
| `backend/.env` | Database credentials |
| `backend/config.py` | API configuration |
| `backend/models.py` | Database schema |
| `backend/routers/` | API endpoints |
| `frontend/src/api.ts` | API client setup |
| `README.md` | Full documentation |

---

**Status:** ✅ Ready to Use  
**Version:** 1.0.0  
**Last Updated:** May 5, 2026
