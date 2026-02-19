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
| Veri Kaynağı | PandaScore API |
| Oyunlar | Valorant, CS2, League of Legends |

---

## Son Yapılanlar

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
- [x] ~~**Supabase RLS güvenliği**~~ — Tamamlandı (2026-02-19): tüm 6 tablo korumalı

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
