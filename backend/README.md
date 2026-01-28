# 🎮 Esports Data Platform - Backend

Professional ETL pipeline for syncing esports data from PandaScore API to Supabase.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
# Activate virtual environment
.\venv\Scripts\activate

# Install packages
pip install -r requirements.txt
```

### 2. Configure Environment

Create `.env` file:
```env
PANDASCORE_TOKEN=your_token_here
PANDASCORE_BASE_URL=https://api.pandascore.co
DATABASE_URL=postgresql://postgres:password@host:5432/postgres
LOG_LEVEL=INFO
SYNC_INTERVAL_MINUTES=15
BATCH_SIZE=50
```

### 3. Run ETL
```bash
# Sync Valorant matches
python run.py

# Sync all games
python run.py --all-games

# Sync specific game with limit
python run.py --game cs-go --limit 100
```

## 📁 Project Structure
```
backend/
├── .env                    # Environment variables (SECRET)
├── config.py              # Configuration management
├── database.py            # Database connection
├── run.py                 # Main entry point
├── requirements.txt       # Python dependencies
├── etl/                   # ETL scripts
│   ├── pandascore_client.py  # API client
│   ├── data_cleaner.py       # Data validation
│   └── sync_matches.py       # Main sync logic
└── utils/                 # Utilities
```

## 🗄️ Database Schema

- **games** - Supported games (valorant, cs-go, lol)
- **teams** - Esports teams
- **tournaments** - Tournament information
- **matches** - Match records with teams and schedule

## 🔧 Commands
```bash
# Test database connection
python database.py

# Test PandaScore API
python -m etl.pandascore_client

# Test data cleaner
python -m etl.data_cleaner

# Run full sync
python run.py
```

## 📊 Features

✅ **PandaScore API Integration** - Fetch live esports data  
✅ **Data Cleaning** - Filter invalid matches  
✅ **UPSERT Logic** - No duplicate entries  
✅ **Multiple Games** - Valorant, CS2, LoL support  
✅ **Error Handling** - Robust error management  
✅ **PostgreSQL** - Normalized database schema  

## 🎯 Next Steps

- [ ] Automated scheduling (GitHub Actions / Cron)
- [ ] Error logging to file
- [ ] Discord/Email notifications
- [ ] Frontend API endpoints
- [ ] Player statistics sync

## 👨‍💻 Developer

Built by Ömer Faruk Selçuk  
Karabük University - Computer Engineering