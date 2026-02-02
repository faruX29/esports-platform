# 🎮 Esports Platform

Full-stack esports data platform with Python ETL pipeline and React frontend.

![Python](https://img.shields.io/badge/Python-3.11-blue)
![React](https://img.shields.io/badge/React-18-61DAFB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 📊 Features

- **130+ Live Matches** from PandaScore API
- **3 Games Support:** Valorant, CS2, League of Legends
- **Team & Tournament Pages**
- **Favorites System** with localStorage
- **Auto-refresh** every 30 seconds
- **Search & Filters** (game, date, teams)
- **Automated Sync** via GitHub Actions (every 15 minutes)

## 🛠️ Tech Stack

### Backend (Python ETL)
- Python 3.11+
- PostgreSQL (Supabase)
- psycopg3
- PandaScore API
- GitHub Actions

### Frontend (React)
- React 18 + Vite
- React Router
- Supabase JS Client
- CSS-in-JS

## 🚀 Quick Start

### Backend Setup
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # Mac/Linux

pip install -r requirements.txt

# Create .env file
# DATABASE_URL=your_supabase_url
# PANDASCORE_TOKEN=your_api_token

python run.py --all-games --limit 50
```

### Frontend Setup
```bash
cd frontend
npm install

# Create .env file
# VITE_SUPABASE_URL=your_supabase_url
# VITE_SUPABASE_ANON_KEY=your_anon_key

npm run dev
```

## 📸 Screenshots

### Home Page
![Home](docs/screenshot-home.png)

### Team Page
![Team](docs/screenshot-team.png)

### Tournament Page
![Tournament](docs/screenshot-tournament.png)

## 🗄️ Database Schema
```sql
- games (id, name, slug)
- teams (id, name, acronym, logo_url)
- tournaments (id, name, tier, game_id)
- matches (id, game_id, team_a_id, team_b_id, tournament_id, scheduled_at, status)
```

## 🤖 Automation

GitHub Actions workflow syncs matches automatically:
- **Schedule:** Every 15 minutes
- **Manual trigger:** Available via Actions tab
- **150 matches** fetched per run (50 per game)

## 📚 API Reference

Uses [PandaScore API](https://pandascore.co/) for esports data:
- `/valorant/matches/upcoming`
- `/csgo/matches/upcoming`
- `/lol/matches/upcoming`

## 🎯 Future Features

- [ ] Past matches history
- [ ] Player statistics
- [ ] Live match updates (WebSocket)
- [ ] Dark/Light mode toggle
- [ ] Notification system
- [ ] Mobile app (React Native)

## 👨‍💻 Author

**Ömer Faruk Selçuk**  
Computer Engineering Student, Karabük University

## 📄 License

MIT License - feel free to use this project for learning!

## 🙏 Acknowledgments

- [PandaScore](https://pandascore.co/) for esports API
- [Supabase](https://supabase.com/) for database hosting
- [Vite](https://vitejs.dev/) for blazing fast frontend tooling