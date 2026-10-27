# feXt — teknik kılavuz

> ⚠️ **BU REPO PUBLIC.** Sır, anahtar, metrik, kullanıcı sayısı, strateji, iş planı
> veya kişi adı commit'leme. Durum ve kararlar için `../fext-notlar/PROGRESS.md`
> dosyasını oku (private repo, bu reponun kardeş klasörü).

## Proje
feXt (fextesports.com), VALORANT, CS2 ve League of Legends için Türkçe espor veri
sitesi: maçlar, skorlar, turnuvalar, takım/oyuncu sayfaları, Türkçe üretilen haberler
ve **Fextopus** (Elo tabanlı maç tahmin motoru, isabeti açıkça yayınlanır).
Veri PandaScore'dan gelir; Python ETL Supabase Postgres'e yazar, React SPA okur.

## Yığın
- **Frontend:** React 19, Vite 7, React Router 7, JavaScript (TypeScript YOK), lucide-react
- **Backend:** Python 3.13 (CI), psycopg 3, requests, google-genai (haber metni)
- **Veritabanı:** Supabase (Postgres 17, Auth, Storage, Vault, pg_cron, pg_net)
- **Barındırma:** Vercel (`frontend/` kökü; `main`'e push → otomatik deploy)
- **Mobil:** Capacitor 8 (Android; `frontend/android/`), aynı Vite build'ini sarar. Push FCM ile (Firebase `fext-502812`)
- **Zamanlanmış işler:** GitHub Actions + Postgres içinde pg_cron
- **Sosyal video:** Pillow + imageio-ffmpeg

## Klasörler
- `backend/run.py`: ETL giriş noktası (tüm işler bayraklarla)
- `backend/etl/`: senkron (`sync_matches.py`, `sync_players.py`), tahmin (`predict.py`), haber (`news_generator.py`)
- `backend/etl/adapters/`: harici API adaptörleri
- `backend/sql/`: şema/RPC/göç dosyaları; Supabase'e **elle** uygulanır
- `backend/isletim/`: günlük sağlık raporu (`saglik.py`) ve haftalık yedeğin Python tarafı (`yedek.py`)
- `frontend/src/pages/`: sayfalar · `components/` · `hooks/` · `utils/`
- `frontend/src/theme.js`: renk token'ları (tek kaynak) · `features.js`: özellik bayrakları
- `frontend/middleware.js`: Edge middleware; botlara prerender HTML basar (SEO)
- `frontend/api/`: Vercel fonksiyonları (`og.js` paylaşım görseli, `sitemap.js`)
- `social/`: sosyal medya video üreticileri; çıktı `social/cikti/` (gitignore)
- `.github/workflows/`: zamanlanmış ETL, içerik üretimi, günlük radar videosu
- `frontend/android/`: Capacitor Android projesi (`capacitor.config.json`). Uygulamaya özel kod:
  `utils/platform.js` (`UYGULAMA`, `disariKok()`), `utils/uygulamaKurulum.js` (geri tuşu, splash),
  `components/UygulamaKopru.jsx` + `utils/push.js` (push), `utils/uygulamaGiris.js` (Google, PKCE)

## Komutlar
```bash
# frontend
cd frontend && npm run dev | npm run build | npm run lint
# backend (cd backend)
python run.py --all-games --limit 100 --predict --stats   # maç senkronu + tahmin + istatistik
python run.py --live --all-games --limit 20 --fix-orphans # canlı maçlar + takılı kalanlar
python run.py --generate-news --news-hours 2              # haber üretimi
python run.py --help                                      # diğer tüm bayraklar
python isletim/saglik.py --kuru                           # sağlık raporunu göndermeden ekrana bas
# mobil (cd frontend) — JDK 21 gerekir (Gradle 8.14 Android Studio'nun JDK 25'iyle koşmaz)
npm run build:app                                         # vite --mode app + cap sync android
cd android && ./gradlew assembleDebug                     # APK: app/build/outputs/apk/debug/
# sosyal (cd social)
python radar.py [YYYY-AA-GG] | python karne.py | python champions.py [grup] | python asama.py kazananlar
```

## Ortam değişkenleri (yalnız adlar; değerler `.env` ve GitHub Secrets'ta)
- backend: `DATABASE_URL` `PANDASCORE_TOKEN` `GEMINI_API_KEY` `RESEND_API_KEY` `SUPABASE_URL` `SUPABASE_SERVICE_KEY`
- frontend: `VITE_SUPABASE_URL` `VITE_SUPABASE_ANON_KEY` `VITE_TURNSTILE_SITE_KEY` `SITE_URL`
- Postgres Vault: `pandascore_token` (canlı senkron okur)
- uygulama: `frontend/.env.app` (`VITE_TURNSTILE_SITE_KEY`; gerisi `.env`'den, eksikse `build:app` durur) ve
  `frontend/android/app/google-services.json` (Firebase; ikisi de gitignore, yoksa release derlemesi durur)

## Altyapı gerçekleri
- **Canlı skor** Postgres'te koşar: pg_cron `canli-senkron` dakikada bir (`backend/sql/canli_senkron.sql`). Sorun olursa: `cron.job_run_details`.
- **Canlı skor istemciye** Realtime Broadcast ile gider: `matches` tetikleyicisi durum/skor/kazanan/saat değişince ifade başına tek mesajı herkese açık `maclar` konusuna atar (`backend/sql/canli_yayin.sql`). İstemcide tek ortak kanal: `subscribeToMatchesUpdates` (`supabaseClient.js`); olay `{eventType, new, old}`, yeniden bağlanınca `RESYNC`. Son mesajlar: `realtime.messages where topic='maclar'`.
- **Ana sayfa verisi** tek RPC'den: `get_home_feed()` (`backend/sql/ana_sayfa_akisi.sql`, `utils/anaSayfaAkisi.js`); RPC yoksa eski sorgulara düşer. Periyodik yenileme `hooks/useYenileme.js` ile (gizli sekmede durur).
- **GitHub Actions kısa cron'ları eliyor:** `*/5` fiilen saatlerce gecikir. Sık iş için pg_cron kullan.
- **PandaScore:** saatte 1000 istek (`X-Rate-Limit-Remaining` başlığı).
- **Vercel ücretsiz CPU kotası** dar; middleware her istekte koşar, `api/og` pahalıdır.
- **Vercel CDN Requests** (Hobby: ayda 1M) bot dahil her isteği sayar; kotayı yiyen botu Firewall → Top User Agents'ta bul, custom rule'u UA **Contains** ile kur ("Matches expression" eşleşmedi) ve bot UA'lı curl'de 403 gör. Değersiz bot listesi `middleware.js` `DEGERSIZ_BOT_RE` ile `public/robots.txt`'te eş tutulur.
- **Gözler:** `saglik.yml` her sabah kontrol eder (eşik aşılırsa "SORUN" e-postası, yoksa yalnız Pazartesi). Tarayıcı hataları ve CSP ihlalleri `client_errors`'a yazılır (`utils/hataBildir.js`, yalnız üretim build'i, oturum başına 5). Eşikler `isletim/saglik.py` başında.
- **Yedek:** `yedek.yml` Pazar gecesi `pg_dump` + hesap kimlikleri (şifre hash'i yok) → `age` ile şifreli → ayrı private repoya Release; aynı koşuda boş Postgres 17'ye geri yükleyip satır sayısını doğrular.
- `sync-live.yml` (adı "5-min", fiilen 2-6 saatte bir) pg_cron'un yapmadığı işleri yapar: takılı "canlı" maçı bitirme (orphan), hayalet yaklaşan maç, canlı maç istatistiği. pg_cron var diye silme.
- `sync-liquipedia.yml` adı yanıltıcı: Liquipedia senkronu kapalı, iş akışı artık içerik (önizleme, turnuva özeti, transfer haberi) üretiyor.

## Kod kuralları
- UI metinleri ve kod yorumları Türkçe; çevredeki kodun dilini ve yoğunluğunu izle.
- **Yeni kodda inline stil kullan, mevcut kodla tutarlı ol. Tailwind kullanma.** Renkler `theme.js`'den.
- İkon `lucide-react`; UI'da emoji yok.
- Harici API çağrıları `backend/etl/adapters/` üzerinden; sessiz hata yok, her DB/API hatası loglanır.
- Yeni SQL `backend/sql/` altına, tekrar çalıştırılabilir (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Göreve ilgili klasörden başla, tüm projeyi tarama.

## Mobil uygulama gerçekleri
- Uygulama sayfayı `https://app.fextesports.com`'dan **yerel dosyalarla** açar (`server.hostname`; dışarıda böyle bir
  site yok). Turnstile bu adı ana alan adı üzerinden kabul eder. Web'deki CSP/`vercel.json` uygulamada geçmez.
- `--mode app` build'i `index.html`'den `viewport-fit=cover` ve SW kaydını çıkarır (`vite.config.js`); web'in
  `index.html`'i ve CSP hash'leri bu yüzden değişmez. Android web görünümü sistem çubuklarının arasında durur.
- Push yalnız kayıtlı hesaba: izin ilk kayıtlı oturumda bir kez sorulur, token `push_token_kaydet` ile yazılır,
  **çıkışta silinir** (`utils/push.js birak`). Bildirime basınca `veri.url` (yalnız site içi yol) açılır.
- Google girişi sistem tarayıcısında, dönüş `com.fextesports.app://giris` (Supabase Redirect URLs'te kayıtlı);
  kod ayrı PKCE istemcisiyle takas edilir, ana istemci implicit kalır (şifre sıfırlama linki tarayıcıda açılsın diye).
- Dış link ve `window.open` sistem tarayıcısında açılır; uygulama yerinde kalır.

## Doğrulama (test YOK)
Projede otomatik test yok. Değişiklik şöyle doğrulanır:
- **Veri:** psycopg ile doğrudan sorgu (ör. kazanan–skor çelişkisi sayımı); düzeltmeden önce ve sonra say.
- **RLS/yetki:** anon anahtarla REST'e dışarıdan iste; yazma testi veri değiştirmesin diye `{"id":null}` gönder (42501 = RLS reddetti, 23502 = RLS geçti).
- **SEO/bot HTML:** Googlebot UA ile iste, `?__og=1&cb=<rastgele>` ekleyip önbelleği atla. `<title>` middleware'deki varsayılan kabuk başlığıysa sayfa bozuktur.
- **Frontend:** `npm run build` + `npm run lint`, sonra canlıda ekran görüntüsü.
- **Video:** ffmpeg ile kare çıkarıp bak.
- **Uygulama:** USB'li telefona `adb install -r`, ekran `adb exec-out screencap -p`; web görünümüne
  `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` ile bağlanıp CDP'den durum oku (debug build).

## Asla yapma
- Skoru `results[]` sırasıyla yazma → `team_id` ile eşleştir; sıra `opponents[]` ile aynı değil, skorlar ters yazıldı.
- Maç güncellemesinde skoru takımlarsız yazma → takım ve skor birlikte güncellenir, yoksa satırlar kayar.
- Takımları satırdakiyle eşleşmeyen API yanıtıyla maçı güncelleme → yanlış maça skor yazılır.
- ETL/iş akışı adımını `timeout-minutes` olmadan ekleme → sınırsız adım tüm işi rehin alır.
- Liquipedia `api.php` kullanma → kullanım şartlarına aykırı.
- VLR.gg veya başka siteyi kazıma → izinsiz veri.
- Türkçe karakterli `replace`'ten sonra `assert` atlama → eşleşmezse sessizce hiçbir şey yapmaz.
- LLM'e anlamı/sırası yazılmamış dizi verme (ör. "LLWWW") → ters okur, yanlış haber üretir.
- LLM'e turnuva durumu vermeden elenme/tur atlama yazmasına izin verme → tek maç sonucundan "elendi" uydurur; prompt'ta yasakla (`weekly_news.py`).
- Özel adları çevirtme ("VCT Champions" → "Şampiyonlar Ligi") → prompt'larda `_AD_KURALI` var.
- Doğrulanmamış tarih, saat veya sayı yazma → maç saatleri değişir, üretmeden önce DB'den tazele.
- Turnuva adı olarak `tournaments.name`'i tek başına gösterme → çoğu yalnız aşama ("Group Stage"); `league_name,event_name` de çek, `tournamentDisplayName` (middleware'de `turnuvaAdi`) kullan. Türk takımını da ad listesiyle değil `isTurkishTeam` (`turk_takimlar`) ile bul.
- Navbar'a öğe ekleyip genişliği ölçmeden bırakma → 7 öğe ~1140px ister, altında satır taşar (Giriş/Kayıt kesilir); `Navbar.jsx` `NAV_HAMBURGER_PX`'i güncelle.
- UI'da "Model" ya da "AI" deme → tahmin motorunun adı Fextopus.
- `index.html`'deki satır içi betiği/`onload`'u değiştirip `vercel.json` CSP'sindeki sha256'yı güncellemeden bırakma → CSP zorunluyken betik çalışmaz (hash `dist/index.html`'den hesaplanır). `/api/og` URL'sini middleware dışında üretme → imzasız istek statik karta düşer (`lib/ogImza.js`).
- `matches`'a `postgres_changes` aboneliği açma ya da tabloyu `supabase_realtime` yayınına ekleme → her satır yazımı (ETL'in değişmeyen yazımları dahil) tam satırıyla her açık sekmeye gider. Canlı veri `maclar` Broadcast'inden; yeni abone `subscribeToMatchesUpdates`'i kullanır. Yoklama için düz `setInterval` değil `useYenileme`.
- Middleware'de sayfanın ana varlığını `sbFetch` ile çekme → hatayı "yok"la karıştırır; `sbBul` kullan, boşsa `YOK` dön (404 + noindex), hata SPA'ya düşer (geçici arıza 404 olmasın).
- Middleware yanıtına `s-maxage` koyup CPU'yu koruduğunu sanma → middleware önbellekten önce her istekte koşar.
- Paylaşılan/e-postaya giden linki `window.location.origin` ile kurma → uygulamada `app.fextesports.com` olur; `disariKok()`.
- Capacitor eklentisini web koduna statik import etme → web paketine girer; `UYGULAMA` koşulu + dinamik import.
- Uygulamada `supabase.auth.signOut` öncesi push token'ını bırakmadan çıkış akışı yazma → çıkılan telefon bildirim almaya devam eder.
- Türkçe yerelde İngilizce terimi büyük harfe çevirme → "WINNERS" "WİNNERS" olur.
- Windows'ta Türkçe/Unicode içerikli heredoc ile dosya yazma → cp1254 karakterleri bozar.
- Sosyal videoda Inter dışında font kullanma → Baloo yalnız logoda.
- Sır, metrik veya kişisel bilgi commit'leme → repo PUBLIC. Actions logları da herkese açık: iş akışında satır sayısı, boyut, e-posta ya da hata metni basma (`saglik.py`/`yedek.py` gövdeyi yalnız e-postaya ya da şifreli arşive yazar).
- Kullanıcının yazdığı yeni tabloya yalnız `auth.uid() = user_id` politikası koyma → takip için açılan anonim oturum da `authenticated`'dır; RESTRICTIVE `public.kayitli_oturum()` politikası ekle (`backend/sql/anonim_takip.sql`). İstemcide `useAuth().user` anonimi içermez, anonim kimlik `anonUserId`.
- Kullanıcı tablosunu (`profiles`, `news_likes`) anon'a açma → herkese açık okuma dar görünümden (`profiles_public`, `news_like_counts`); yeni `security_invoker = false` görünümde `revoke all` + yalnız `grant select` şart, yoksa Supabase varsayılan yetkisi anon'a görünüm üzerinden RLS'siz yazma verir.
