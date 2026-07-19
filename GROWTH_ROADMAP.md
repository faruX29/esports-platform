# feXt — Büyüme Yol Haritası (SEO + Mobil)

Amaç: Google'dan organik trafik + mobil uygulama. "Yavaştan, temel atarak" ilerleme notu.
Ücretli adımlar (mağaza hesapları) **beta hazır hissedilince** atılacak.

---

## A) Google'da görünme (SEO)

### ✅ Yapıldı (kod)
- Dinamik `sitemap.xml` (api/sitemap.js) + `robots.txt` → fextesports.com
- Sayfa-bazlı `<title>` / `<meta description>` (SeoHead) + canonical URL
- Sosyal paylaşım kartları (OG): botlara özel HTML (middleware) — /news/*, /match/*
- **Yapısal veri (Schema.org JSON-LD):** Organization + WebSite + SearchAction (index.html)

### ⏳ Kurucu aksiyonu (ücretsiz, ÖNEMLİ)
1. **Google Search Console** → domaini ekle (DNS TXT veya HTML doğrulama) → `sitemap.xml` gönder.
   - Bu olmadan Google indekslemeyi ciddiye almaz. İlk ve en kritik adım.
   - Doğrulama için: Claude'a "search console doğrulama meta'sı ekle <kod>" de → index.html'e koyar.
2. **Bing Webmaster Tools** (bonus, kolay) → aynı sitemap.
3. **Backlink + sosyal:** @fextesports (insta/x/tiktok) + Reddit/Discord toplulukları → ilk trafik + güven sinyali.

### 🔜 Sonraki kod adımları (pozitif etki, sırayla)
- [ ] **Sayfa-bazlı Schema.org**: NewsArticle (haber), SportsEvent (maç), SportsTeam (takım) JSON-LD → Google zengin sonuç.
- [ ] **Botlara ön-render kapsamını genişlet**: şu an sadece /news + /match sosyal-kart alıyor; /team, /player, /tournament de gerçek HTML alsın (Googlebot için içerik). Orta vadede en büyük sıralama kaldıracı.
- [ ] **İçerik üretimi**: özgün Türkçe haber/analiz (AI haber motoru) — skor tabloları HLTV/VLR ile yarışır (zor), haber uzun-kuyrukta sıralanır.
- [ ] Sayfa hızı (Lighthouse) + Core Web Vitals kontrolü.

### Gerçekçi beklenti
Yeni domain **6–12 hafta** otorite kurar. Rekabetçi "espor sonuçları"nda hemen çıkmaz;
önce uzun-kuyruk (takım/oyuncu/maç/turnuva adları) + Türkçe haber. Sabır + düzenli içerik.

---

## B) Mobil uygulama

### ✅ Yapıldı (kod — PWA iskeleti, ücretsiz)
- `manifest.webmanifest` (ad, ikon, tema, standalone) → siteyi "ana ekrana ekle" yapar
- Service worker (`sw.js`) — güvenli: canlı skor cache'lenmez, sadece statik varlık
- Uygulama ikonları (`/icons/*` — mascot'tan üretildi; **yeni mascot gelince tek komut regen**)
- iOS/Android meta etiketleri (apple-touch-icon, standalone)

> İkon regen: yeni mascot'u `public/fext-mascot.svg`'ye koy → Claude'a "ikonları üret" de.

### Yol (ucuzdan pahalıya)
1. **PWA (şimdi hazır, bedava):** ana ekrana eklenir, tam ekran, push bildirim (browser).
   iOS'ta mağazada görünmez ama Safari "Ana Ekrana Ekle" ile çalışır.
2. **Capacitor sarma (mağaza için):** mevcut React sitesini native kabuğa sarar →
   gerçek App Store + Play Store uygulaması, native push. Kod baştan yazılmaz. ~1–2 hafta.
3. **React Native (tam native):** en pahalı, şimdilik gereksiz; ölçeklenince.

### ⏳ Beta hazır olunca (ücretli)
- [ ] **Apple Developer** hesabı ($99/yıl) — App Store
- [ ] **Google Play Developer** hesabı ($25 tek sefer)
- [ ] **Gizlilik Politikası** sayfası (mağaza ZORUNLU) — /privacy
- [ ] Mağaza görselleri: ikon, ekran görüntüleri, açıklama
- [ ] Capacitor kurulumu + build + mağaza gönderimi (Apple incelemesi birkaç gün)
- [ ] Native push için: Firebase (Android) + APNs (iOS) — maç hatırlatma killer özellik

### Not
Killer özellik = favori takımın maçına **push hatırlatma**. PWA'da kısmi (Android tam, iOS kısıtlı),
Capacitor'da tam native. Bu yüzden mağaza paketi (Capacitor) push için değerli.
