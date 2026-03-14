# ⚡ EsportsHub Pro
### *AI-Powered Esports Data & Analysis Platform*

EsportsHub Pro, **PandaScore API** üzerinden gelen ham e-spor verilerini işleyen; AI tabanlı haber özetleri, profesyonel turnuva ağaçları ve derinlemesine oyuncu analizi sunan bir "Data Aggregator" platformudur.

![Python](https://img.shields.io/badge/Python-3.11-blue?style=for-the-badge&logo=python)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![Supabase](https://img.shields.io/badge/Supabase-Database-green?style=for-the-badge&logo=supabase)
![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?style=for-the-badge&logo=vite)

---

## 🚀 Öne Çıkan Özellikler

### 🧠 AI News Engine
* **Dinamik İçerik:** Maç sonuçlarına göre "Sürpriz Galibiyet" veya "Haftanın Maçı" temalı haber özetleri üretir.
* **Tier Önceliği:** Tier S ve A turnuvalar otomatik olarak manşete (Hero) taşınır.
* **Akıllı Filtreleme:** Oyuna özel haber akışı ve son 24 saat odaklı taze içerik motoru.

### 🕵️ Player Scout Engine (v2)
* **Bireysel Metrikler:** Takım ortalamasından bağımsız K/D, HS% ve Impact Score analizi.
* **Dinamik Roller:** LoL (Lane), Valo/CS2 (Role) bazlı akıllı filtreleme sistemi.
* **Karşılaştırma:** İki oyuncuyu yan yana getiren interaktif "Compare Mode".

### 🏆 Pro Tournament Brackets
* **Double Elimination:** Üst (Upper) ve Alt (Lower) bracket ayrımı.
* **Hibrit Görünüm:** Playoff'lar için ağaç (Bracket), grup aşamaları için Liste (ListView) görünümü.
* **SVG Connectors:** Kazanan yollarını (Winner Path) vurgulayan dinamik bağlantı çizgileri.

---

## 🛠️ Teknik Mimari

* **Backend:** Python 3.11 tabanlı ETL Pipeline. 
* **Frontend:** React 18 + Vite. Merkezi state yönetimi için Context API.
* **Veritabanı:** Supabase (PostgreSQL) + RLS Güvenlik katmanı.

---

## 🚀 Hızlı Başlangıç (Local Setup)

### Frontend
```bash
cd frontend
npm install
npm run dev

\### Backend

\- cd backend

\- Install dependencies

\- Run: python run.py --all-games --limit 50




\## 🤖 Automation



GitHub Actions syncs matches automatically every 15 minutes.



\## 👨‍💻 Author



Ömer Faruk Selçuk - Computer Engineering Student, Karabük University



\## 📄 License



MIT License

