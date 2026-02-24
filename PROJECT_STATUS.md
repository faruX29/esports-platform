# Esports Platform — Project Status

> Son güncelleme: 2026-02-19

---

## Mevcut Durum

| Alan | Değer |
|---|---|
| Veritabanındaki tamamlanmış maç | 2.908+ |
| AI Accuracy | **%75.00** (12/16) — H2H ile %40.85'ten sıçradı |
| H2H Sistemi | ✅ Aktif |
| GitHub Actions Timeout | ✅ Çözüldü (incremental sync) |
| Frontend Accuracy Badge | ✅ Dinamik renk (yeşil/sarı/kırmızı) |
| Supabase RLS | ✅ Tüm tablolar güvenli (6/6) |
| Oyuncular (players) | ✅ 193 kayıt (50 takım) |
| Maç istatistikleri (match_stats) | ✅ **6.010 kayıt** (3.005 maç × 2 takım) |
| Veri Kaynağı | PandaScore API |
| Oyunlar | Valorant, CS2, League of Legends |

---

## Son Yapılanlar

### 2026-02-19 (7. güncelleme)
- **Canlı maç desteği ve Türk takımı filtreleri eklendi**
  - `UpcomingMatches.jsx`: `🔴 LIVE NOW` bölümü — `matches` tablosundan `status='running'` çekiliyor
    - Canlı skor (varsa) gösteriliyor; 30s auto-refresh'e dahil edildi
    - Önceden "kayboluyordu" çünkü `upcoming_matches` view'ı sadece `not_started` içeriyordu
  - `src/constants.js`: Türk takımı listesi (Eternal Fire, BBL, FUT, Sangal, Galatasaray vb.)
    - `isTurkishTeam(name)` helper — büyük/küçük harf duyarsız kısmi eşleşme
  - Türk takımı içeren maç kartlarına `🇹🇷 Turkish Pride` badge + altın çerçeve eklendi
  - `TeamPage.jsx` Roster: rol badge'leri role'e göre renk aldı (IGL=mor, Sniper=mavi, Entry=kırmızı...)
    - `ROLE_STYLES` haritası + `getRoleBadge()` helper (18 farklı rol, glow efekti)

### 2026-02-19 (6. güncelleme)
- **Frontend oyuncu roster bileşenleri eklendi**
  - `UpcomingMatches.jsx` modal: iki takımın kadrosu yan yana gösteriliyor (player cards)
  - `TeamPage.jsx`: "Roster" sekmesi eklendi — oyuncu listesi (nickname, rol, fotoğraf)
  - K/D/A yok (PandaScore free tier 403) — "Premium API gerekli" notu eklendi
  - Supabase RLS uyumlu sorgular: `players.team_pandascore_id = teams.id`

### 2026-02-19 (5. güncelleme)
- **sync_match_stats 37x hızlandırıldı** — döngü içi connection → tek connection + executemany batch
  - 100 maç: 159s → 4.3s
  - Tüm 2.795 kalan maç: **26 saniyede** tamamlandı (0.4 dk)
  - match_stats: 20 → **6.010 kayıt** (3.005 maç, hepsi işlendi, sıfır kalan)

### 2026-02-19 (4. güncelleme)
- **Oyuncu & Maç İstatistikleri sistemi eklendi**
  - `etl/sync_players.py` → yeni `PlayerStatsSyncer` sınıfı
  - `players` tablosu: 193 oyuncu yüklendi (PandaScore `/teams/{id}`)
    - `pandascore_id` + `team_pandascore_id` bigint kolonları eklendi (schema fix)
  - `match_stats` tablosu: 20 kayıt (raw_data JSONB'den, API çağrısı yok)
    - `(match_id, team_id)` unique index eklendi (tekrar yazma koruması)
  - `run.py`: `--stats` ve `--players` flag'leri eklendi
  - Workflow: `--stats` her çalışmaya eklendi, `--players` ayrı step oldu
  - K/D/A şimdilik yok (PandaScore free tier 403), ileride ele alınacak

### 2026-02-19 (3. güncelleme)
- **Supabase RLS tamamlandı** — Tüm 6 tablo güvenli hale getirildi:
  - `match_stats` ve `players`: RLS OFF → ON, SELECT politikası eklendi
  - Tüm tablolara `authenticated` rolü için de SELECT politikası eklendi
  - INSERT/UPDATE/DELETE: sadece `service_role` (backend) yapabilir
  - Supabase Advisor'daki 2 kritik uyarı kapatıldı

### 2026-02-19 (2. güncelleme)
- **AI Accuracy %40.85 → %75.00** — H2H sistemi devreye girdi (12/16 doğru)
- **Frontend badge dinamikleştirildi** — accuracy'ye göre renk ve etiket:
  - `≥ %70` → 🔥 Yeşil gradient + "High Accuracy"
  - `%50–69` → 📈 Sarı gradient + "Improving"
  - `< %50`  → 🎓 Kırmızı gradient + "Learning"
- **PROJECT_STATUS.md güncellendi**

### 2026-02-19 (1. güncelleme)
- **`calculate_h2h_bonus` eklendi** — `etl/predict.py`'da eksik olan H2H metodu yazıldı.
  - İki takım arasındaki tarihsel maçları sorgular
  - Min. 2 karşılaşma yoksa `0.0, 0.0` döner (güvenli fallback)
  - Her takıma `±0.05` aralığında bonus uygular
- **Incremental tahmin** — `predict_upcoming_matches` ve `predict_finished_matches` artık yalnızca `prediction_team_a IS NULL` olan maçları işliyor. Tekrar hesaplama yok.
- **`return predictions` hatası düzeltildi** — `predict_upcoming_matches` daha önce `None` döndürüyordu.
- **`run.py` indent düzeltildi** — 7 boşluklu satırlar 8 boşluğa hizalandı.

---

## TODO Listesi

### Öncelikli
- [ ] **Accuracy takibi** — `prediction_team_a` vs gerçek `winner_id` kıyaslaması için ayrı bir script/endpoint yaz
- [ ] **H2H bonus testi** — H2H aktif/pasif accuracy farkını ölçen bir karşılaştırma çalıştır
- [x] ~~**Supabase RLS güvenliği**~~ — Tamamlandı (2026-02-19)
- [ ] **K/D/A istatistikleri** — PandaScore premium tier gerekiyor; ücretsiz alternatif araştır (HLTV scraping vb.)

### Orta Vadeli
- [ ] **Accuracy'yi %50+ çıkar** — Ek feature'lar: son form streak, ev/deplasman avantajı (online maçlarda N/A), tur bazlı ağırlık
- [ ] **GitHub Actions timeout monitörü** — Workflow süresi loglanarak Supabase'e kaydedilsin; trend takibi yapılabilsin
- [ ] **Prediction confidence threshold** — Confidence < 0.05 olan tahminleri frontend'de "Belirsiz" olarak işaretle

### Düşük Öncelik
- [ ] Frontend'de live accuracy göstergesi
- [ ] PandaScore rate-limit yönetimi (429 retry logic)

---

## Mimari Özet

```
esports-platform/
├── backend/
│   ├── run.py                  # Ana giriş noktası (CLI)
│   ├── database.py             # Supabase/psycopg bağlantısı
│   └── etl/
│       ├── pandascore_client.py  # API çekme
│       ├── data_cleaner.py       # Ham veri temizleme
│       ├── sync_matches.py       # DB upsert
│       └── predict.py            # AI tahmin motoru
├── frontend/                   # React/Vite
└── .github/workflows/
    └── sync-matches.yml        # Her saat çalışır, timeout: 10 dk
```

### Tahmin Formülü

```
strength = recent_rate * 0.6 + total_rate * 0.3 + tier_score * 0.1
strength += h2h_bonus  # ±0.05 aralığı

prob_a = strength_a / (strength_a + strength_b)
confidence = |prob_a - prob_b|
```
