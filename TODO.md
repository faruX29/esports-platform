# EsportsHub Pro - Dynamic Product Roadmap & Tracker

## 🛠️ Bölüm 1: Mevcut Özelliklerin Stabilizasyonu ve Optimizasyonu (Kusursuzlaştırma)
- [x] News & Forum UI: Forum upgrade (avatar, sil, sayaç, login CTA, sort toggle, yorum badge) tamamlandı ve build doğrulandı.
- [x] Supabase Migration: forum_upgrade.sql çalıştırıldı (profiles_select_public + news_comment_votes RLS).
- [x] News & Forum UI Testi: Edge-case bug'ları veya stil hataları varsa temizle.
- [x] Dashboard — Bugünün maçları görünmüyordu: showAllTournamentTiers default false→true, isHeroTier null-safe yapıldı.
- [ ] Past Matches & Tournaments: Veri haritalama hatalarını incele, null dönen alanları sıfır hata seviyesine getir.
- [ ] Players & Teams: Oyuncu profilleri ve takım sayfalarındaki veri senkronizasyonunu kontrol et, layout kaymalarını engelle.
- [ ] Global Power Rankings: Sıralama motorunun veri çekme performansını ve doğruluğunu optimize et.

## 🚀 Bölüm 2: Yeni Eklenecek Kritik Özellikler (Lansman Modülleri)
- [ ] Canlı Maçlar & Canlı Turnuvalar: Adapter Pattern kullanarak PandaScore/Liquipedia canlı veri boru hatlarını kur ve backend caching katmanını bağla.
- [ ] Anlık Bildirim Sistemi (Notifications): Favoriye alınan takımlar veya bildirim zili açılmış maçlar için anlık uyarı mekanizmasını tasarla.
- [ ] Oyuncu İstatistikleri (Player Stats): Scout Engine'in temelini oluşturacak derinlemesine espor performans metriklerini frontend/backend katmanına ekle.

## 🧠 Bölüm 3: Gelecek Vizyonu ve Arka Plan (Unutulmaması Gerekenler - Backlog)
*Not: Bu maddeler projenin ilerleyen dönemlerinde açılacaktır, sadece hafızada kalması için burada listelenmektedir.*
- [ ] Maçın Adamı (Match MVP) Oylama Motoru ve Lig Finalleri Sponsorluk Entegrasyonu.
- [ ] Mini Games ve Espor Tahmin (Prediction) Oyunları Altyapısı.
- [ ] Community (Topluluk) Alanları ve Platforma Özel Röportajlar/İçerik Sekmesi.
- [ ] Oyun Yelpazesinin Genişletilmesi (İlk olarak Dota 2, ardından diğer espor branşları).
- [ ] Şirketleşme & Hukuk: Genç Girişimci Desteği, Teknokent Başvurusu, KVKK ve Kullanıcı Sözleşmeleri Altyapısı.
- [ ] Gelir Modeli: AdMob/Unity Ads, Premium Üyelik (Stripe/IAP) ve Takım Ürünleri Market Komisyon Altyapısı.
