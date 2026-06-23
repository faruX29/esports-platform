# EsportsHub Pro - SaaS Startup Blueprint & Rules

## 1. Project Vision & Context
EsportsHub Pro is a high-performance SaaS platform designed for esports scouting agencies and hardcore fans. It utilizes a hybrid database architecture (PostgreSQL via Supabase) and integrates external esports APIs (PandaScore/Liquipedia).
- **Primary Coding Agent:** Claude (VS Code Extension)
- **Strategic Architect:** Gemini

## 2. Core Tech Stack
- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **Backend:** Python 3.13, Psycopg3, Python-dotenv
- **Database:** Supabase (Hybrid schema: Handles UUIDs and BigInt tournament IDs seamlessly)

## 3. Strict Coding Standards (The Constitution)
- **Clean Code & Architecture:** Code must be highly modular, self-documenting, and strictly typed. No repetitive or bloated functions.
- **Design Patterns:** Use the **Adapter Pattern** for all external API integrations (PandaScore, Liquipedia) to decouple third-party data from our database core.
- **API Optimization:** Implement strict caching mechanisms on the backend to minimize API request counts and avoid hitting rate limits.
- **Error Handling:** No silent fails. Every database transaction and API call must include resilient error boundaries.

## 4. Product Roadmap & Priorities

### Phase 1: Polishing the Core (Current MVP - Zero Bugs Policy)
- **Past Matches & Tournaments:** Optimize data mapping.
- **News Engine:** Transform the news section into a high-engagement, forum-like interactive layout allowing user comments.
- **Players, Teams & Rankings:** Stabilize current data structures.

### Phase 2: Upcoming Features (Launch Phase)
- **Live Match Engine:** Integration of real-time matches and tournaments using optimized polling or Supabase Realtime.
- **Push Notifications:** Instant alerts for favorited matches or teams.
- **Player Stats:** In-depth technical statistics for esports performance analysis.

### Phase 3: Future Upgrades (Post-Launch)
- Match MVP Voting Engine, Mini-games, Prediction models, and expanding game coverage (Starting with 3 core games -> Adding Dota 2 -> Global expansion).