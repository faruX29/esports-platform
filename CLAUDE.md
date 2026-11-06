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
- **Fontlar:** Inter + Baloo 2 kendi alan adımızdan (`@fontsource-variable`, `src/fontlar.css`, `main.jsx`'te dinamik import → ilk boyamayı beklemez); aile adları `'Inter Variable'`, `'Baloo 2 Variable'`

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
python kadro.py --takim <id> [--gun 30]                   # Türk takımı kadro Reels'i (işaretlemez); argsız = radar işi
```

## Ortam değişkenleri (yalnız adlar; değerler `.env` ve GitHub Secrets'ta)
- backend: `DATABASE_URL` `PANDASCORE_TOKEN` `GEMINI_API_KEY` `RESEND_API_KEY` `SUPABASE_URL` `SUPABASE_SERVICE_KEY`
- frontend: `VITE_SUPABASE_URL` `VITE_SUPABASE_ANON_KEY` `VITE_TURNSTILE_SITE_KEY` `SITE_URL`
- Postgres Vault: `pandascore_token` (canlı senkron okur)
- uygulama: `frontend/.env.app` (`VITE_TURNSTILE_SITE_KEY`; gerisi `.env`'den, eksikse `build:app` durur) ve
  `frontend/android/app/google-services.json` (Firebase) ve `frontend/android/keystore.properties` (Play upload anahtarı; `.jks` repo dışında);
  hepsi gitignore, yoksa release derlemesi durur. `gradlew` `ANDROID_HOME` ister (`%LOCALAPPDATA%\Android\Sdk`)

## Altyapı gerçekleri
- **Canlı skor** Postgres'te koşar: pg_cron `canli-senkron` dakikada bir (`backend/sql/canli_senkron.sql`). Sorun olursa: `cron.job_run_details`.
- **Canlı skor istemciye** Realtime Broadcast ile gider: `matches` tetikleyicisi durum/skor/kazanan/saat değişince ifade başına tek mesajı herkese açık `maclar` konusuna atar (`backend/sql/canli_yayin.sql`). İstemcide tek ortak kanal: `subscribeToMatchesUpdates` (`supabaseClient.js`); olay `{eventType, new, old}`, yeniden bağlanınca `RESYNC`. Son mesajlar: `realtime.messages where topic='maclar'`.
- **Ana sayfa verisi** tek RPC'den: `get_home_feed()` (`backend/sql/ana_sayfa_akisi.sql`, `utils/anaSayfaAkisi.js`); RPC yoksa eski sorgulara düşer. Periyodik yenileme `hooks/useYenileme.js` ile (gizli sekmede durur).
- **GitHub Actions kısa cron'ları eliyor:** `*/5` fiilen saatlerce gecikir. Sık iş için pg_cron kullan.
- **Saati önemli GitHub işi:** günlük `schedule` de 2,5-8 sa gecikiyor; pg_cron → `workflow_dispatch` ile başlat (`backend/sql/sosyal_tetik.sql`, Vault `github_dispatch_token`), schedule'ı yedek bırak ve son 12 saatte dispatch varsa atlat (`social-radar.yml` `kontrol` işi).
- **PandaScore:** saatte 1000 istek (`X-Rate-Limit-Remaining` başlığı).
- **Vercel ücretsiz CPU kotası** dar; middleware her istekte koşar, `api/og` pahalıdır.
- **Vercel CDN Requests** (Hobby: ayda 1M) bot dahil her isteği sayar; kotayı yiyen botu Firewall → Top User Agents'ta bul, custom rule'u UA **Contains** ile kur ("Matches expression" eşleşmedi) ve bot UA'lı curl'de 403 gör. Değersiz bot listesi `middleware.js` `DEGERSIZ_BOT_RE` ile `public/robots.txt`'te eş tutulur.
- **Gözler:** `saglik.yml` her sabah kontrol eder (eşik aşılırsa "SORUN" e-postası, yoksa yalnız Pazartesi). Tarayıcı hataları ve CSP ihlalleri `client_errors`'a yazılır (`utils/hataBildir.js`, yalnız üretim build'i, oturum başına 5). Eşikler `isletim/saglik.py` başında. Ağdaki 4xx/5xx (Supabase 500, 406) oraya **düşmez**; Lighthouse JSON'unda `network-requests` ya da tarayıcıda `performance.getEntriesByType('resource')` `responseStatus` ile bak.
- **Hız ölçümü:** PSI API'sinin anahtarsız kotası 0; yerelde Lighthouse (`npx lighthouse <url> --output=json`, mobil öntanım) + `vite preview` ile eski/yeni build'i art arda ölç (veri ve makine değişkenliği büyük, 2+ koşu). Sunucu TTFB ~80 ms (fra1, middleware insana +20 ms); LCP'yi veri + ana iş parçacığı belirliyor.
- **Yedek:** `yedek.yml` Pazar gecesi `pg_dump` + hesap kimlikleri (şifre hash'i yok) → `age` ile şifreli → ayrı private repoya Release; aynı koşuda boş Postgres 17'ye geri yükleyip satır sayısını doğrular.
- `sync-live.yml` (adı "5-min", fiilen 2-6 saatte bir) pg_cron'un yapmadığı işleri yapar: hayalet yaklaşan maç, canlı maç istatistiği, 404 force-finish. Takılı "canlı" maçı (`/running`'den düşen) ve saati 30 dk geçmiş başlamamış maçı (iptal/ertelenen `/running`'e hiç girmez) artık pg_cron da `/matches/{id}` ile sorar (`canli_senkron.sql`). pg_cron var diye silme.
- `sync-liquipedia.yml` adı yanıltıcı: Liquipedia senkronu kapalı, iş akışı artık içerik (önizleme, turnuva özeti, transfer haberi) üretiyor.
- **Takım logosu yedeği:** PandaScore'u kesen ağlar ("Güvenli İnternet" filtresi) için logolar Supabase Storage `gorsel-yedek`'te; pg_cron `gorsel-yedek` → Edge Function `gorsel-yedek` kopyalar, site PandaScore açılmazsa yedeğe düşer (`utils/gorsel.js` `yedekGorsel`, `InitialsImage`, `imageGuard`). Yol kuralı (`/images/` sonrası, dosya adı `thumb_`) fonksiyonda ve `gorsel.js`'te aynı kalmalı.

## Kod kuralları
- UI metinleri ve kod yorumları Türkçe; çevredeki kodun dilini ve yoğunluğunu izle.
- **Yeni kodda inline stil kullan, mevcut kodla tutarlı ol. Tailwind kullanma.** Renkler `theme.js`'den.
- İkon `lucide-react`; UI'da emoji yok.
- 12 px'ten küçük yazı `fontSize: yazi(N)` ile (`theme.js`; ≤768 px'te en az 12 px). Metin rengi `--text-1…5` ya da `--*-fg` token'ı (`--canli-fg`, `--altin-fg`, `--yesil-fg`, `--tr-fg`…); `--text-6`, `--line*` ve ham marka hex'i (`#FF4655`, `#f0c040`, `#4CAF50`) metinde 4,5:1 tutmaz (aydınlık temada hiç). Durum rozeti yazısı `statusStyle(...).fg`. Oyun rengi metinde `oyunFg(id)` / hex'ten `oyunMetni(gc)`; token'ı olmayan süs rengi (rol rozeti, pastel etiket) metinde `metinTonu(hex)` (`color-mix`, aydınlıkta koyulaştırır). Bu üçü `var()`/`color-mix` döner: alfa eki (`${renk}22`) ve zemin için hex'i ayrı tut. Görünmez başlık: `className="gorsel-gizli"` (`index.css`).
- Animasyon `hooks/useHareket.js` + `components/Animasyon.jsx` ile (ekrana girince başlar, "hareketi azalt"ta son hâl); rAF'li geçişi sayfa bileşeninde değil küçük alt bileşende tut (her kare yalnız onu çizsin). Sonsuz (`infinite`) animasyonda yalnız `opacity`/`transform` canlandır: `box-shadow`/`background-position` her karede boyatır (ana sayfada 13 canlı noktası boyamayı ~10 kat artırıyordu); parıltı sabit gölge olsun.
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
- **SEO/bot HTML:** Googlebot UA ile iste, `?__og=1&cb=<rastgele>` ekleyip önbelleği atla. `<title>` middleware'deki varsayılan kabuk başlığıysa sayfa bozuktur. `__og=1` değersiz bot kontrolünü de atlar: GPTBot gibi `DEGERSIZ_BOT_RE` botunu yalnız `?cb=` ile dene (kabuk dönmeli).
- **Frontend:** `npm run build` + `npm run lint`, sonra canlıda ekran görüntüsü.
- **Animasyon:** gizli tarayıcı panelinde IntersectionObserver tetiklenmez; ekrana girince başlayanı konsolda `window.IntersectionObserver = undefined` + SPA içi gezinmeyle (`pushState` + `popstate`) zorla.
- **Yerel dev:** `index.html` SW'yi dev'de de kaydeder, `/src/` modüllerini önbelleğe alır; "does not provide an export named" görürsen SW'yi kaldır + `caches.delete('fext-static-v1')`.
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
- Yeni LLM haber türünü `_generate_with_backoff` + `_parse_llm_json` ile doğrudan çağırma → `_uret_makale` kullan (dolgu kontrolü: bulursa bir kez yeniden yazdırır, yine varsa cümleyi atar; kalıplar `_DOLGU_KALIPLARI`, istem kuralı `_DOLGU_KURALI`). İsteme olasılığı ondalık verme ("0.62" → "yüzde 0.62'lik"), `%62` yaz. Haber satırını `team_a_logo`/`team_b_logo`'suz yazma → kapakta ve paylaşım kartında baş harf çıkar.
- Haber metnini şablonla üretme, "son oynanan maçın galibi"ni şampiyon sayma, sürprizi eşiksiz yazma → yalnız `news_articles` gösterilir; şampiyon final maçından; eşik `SURPRIZ_ESIK` (`news_generator.py`).
- Doğrulanmamış tarih, saat veya sayı yazma → maç saatleri değişir, üretmeden önce DB'den tazele.
- Turnuva adı olarak `tournaments.name`'i tek başına gösterme → çoğu yalnız aşama ("Group Stage"); `league_name,event_name` de çek, `tournamentDisplayName` (middleware'de `turnuvaAdi`) kullan. Türk takımını da ad listesiyle değil `isTurkishTeam` (`turk_takimlar`) ile bul.
- `App.jsx` `<main>`'in `minHeight`'ini kaldırma ya da sayfanın yükleme hâlini "Yükleniyor..." yazısıyla bırakma → footer ekrana çıkıp veri gelince itilir (CLS); yer tutan iskelet kullan. Ana sayfada veriyle beliren bölüme (Aktif Turnuvalar, Son Sonuçlar) yüklenirken gerçek boyda iskelet ver: yoksa altındaki şerit + Maç Programı yavaş telefonda ~600 px itiliyordu (CLS 0,26). Hızlı bağlantıda veri ilk boyamadan önce geldiği için görünmez; `get_home_feed`'i geciktirip ölç.
- Navbar'a öğe ekleyip genişliği ölçmeden bırakma → satır taşınca lucide ikonları flex içinde ezilir; 8 öğe ikonlu ~1410 px, ikonsuz ~1234 px ister (girişli). Ölçüm yöntemi ve eşikler (`NAV_HAMBURGER_PX`, `NAV_IKONLU_PX`) `Navbar.jsx` başında; ikisini de yeniden ölç.
- UI'da "Model" ya da "AI" deme → tahmin motorunun adı Fextopus.
- `index.html`'e `data-varsayilan="<anahtar>"`'sız varsayılan `<meta>`/`<title>` ekleme ya da tek oyunluk sayfada ortak `setActiveGame`'i çağırma → React 19 etiketi üzerine yazmaz, DOM'da çift olur (`SeoHead` yalnız işaretliyi ayırır); sayfa oyunu `useSayfaOyunu` (`?oyun=`) ile tutulur, ana sayfa filtresi bozulmaz.
- `index.html`'deki iki satır içi betiği değiştirip `vercel.json` CSP'sindeki sha256'yı güncellemeden bırakma → CSP zorunluyken betik çalışmaz (hash `dist/index.html`'den hesaplanır). Satır içi `onload=` gibi olay özniteliği ekleme (`'unsafe-hashes'` 6 Kas'ta çıktı); dış font/CSS alanı ekleme (CSP'de yalnız `'self'`). `/api/og` URL'sini middleware dışında üretme → imzasız istek statik karta düşer (`lib/ogImza.js`).
- `matches`'a `postgres_changes` aboneliği açma ya da tabloyu `supabase_realtime` yayınına ekleme → her satır yazımı (ETL'in değişmeyen yazımları dahil) tam satırıyla her açık sekmeye gider. Canlı veri `maclar` Broadcast'inden; yeni abone `subscribeToMatchesUpdates`'i kullanır. Yoklama için düz `setInterval` değil `useYenileme`.
- Middleware'de sayfanın ana varlığını `sbFetch` ile çekme → hatayı "yok"la karıştırır; `sbBul` kullan, boşsa `YOK` dön (404 + noindex), hata SPA'ya düşer (geçici arıza 404 olmasın).
- Önbelleğe giren yanıtta (`api/sitemap.js` gibi `s-maxage`/`stale-while-revalidate`) veri hatasını boş 200'e çevirme → boş sonuç günlerce sunulur (maç sitemap'i Google'a 0 URL gitti); fırlat, 503 + `no-store` dön.
- Her sayfa açılışında çağrılan RPC'de `matches`'ı tam taratma (ör. `cross join lateral` + `any()`, pencere fonksiyonu) → önbellek soğukken saniyeler sürer; takım başına `limit`'li indeks araması yaz, `explain (analyze, buffers)` ile doğrula (`get_teams_recent_form.sql`).
- Middleware yanıtına `s-maxage` koyup CPU'yu koruduğunu sanma → middleware önbellekten önce her istekte koşar.
- Paylaşılan/e-postaya giden linki `window.location.origin` ile kurma → uygulamada `app.fextesports.com` olur; `disariKok()`.
- Capacitor eklentisini web koduna statik import etme → web paketine girer; `UYGULAMA` koşulu + dinamik import.
- Uygulamada `supabase.auth.signOut` öncesi push token'ını bırakmadan çıkış akışı yazma → çıkılan telefon bildirim almaya devam eder.
- Türkçe yerelde İngilizce terimi büyük harfe çevirme → "WINNERS" "WİNNERS" olur. CSS `textTransform: 'uppercase'` da aynı (`lang="tr"`): İngilizce ad (takım, oyun, "Tier") gösteren büyük harfli öğeye `lang={adDili(ad)}` ya da `lang="en"` ver (`utils/dil.js`); statik Türkçe etikete verme.
- Saati geçmiş `not_started` maçı "Yaklaşan" gösterme → senkron saatlerce gecikiyor; rozet `statusStyle(status, scheduled_at)`, koşul `saatiGecti` (`theme.js`), metin "Sonuç bekleniyor".
- Fextopus "en güvendiği" için ayrı eşik yazma → her yerde favori ≥%70. `get_prediction_accuracy(0)` ve `fextopus_isabet` aynı özetten okur: `fextopus_isabet_ozet` materialized view'ı, pg_cron `isabet-tazele` 10 dk'da bir tazeler (`fextopus_isabet_view.sql`). Her istekte `matches`'ı taratma: soğuk önbellekte anon'un 3 sn `statement_timeout`'unu aşıp 500 dönüyordu.
- Eleme ağacını `round_info`'yu sabit sütunlara eşleyerek ya da "tekrar" sanılan maçı silerek kurma → büyük çift elemelerde alt ayak turları çakışıp maçlar sessizce kayboluyordu. Ağaç `utils/bracketModel.js`'te kurulur; bağlantı takımdan doğrulanır, doğrulanamayan aşama listeye düşer. Değiştirince tüm turnuvalarda "her maç tam bir kez" denetimini yeniden koş.
- Turnuvayı lige (`/lig/<slug>`) frontend ya da middleware'de ad eşleyerek bağlama → tek kaynak `ligler` tablosu + `lig_eslesir`/`lig_sayfasi`/`turnuva_ligi` (`backend/sql/ligler.sql`); yeni lig = tabloya satır, kod değişmez.
- Kadroyu transfer kaydı yazmadan güncelleyen adımı (`--players`, `transfer=None`) transfer tespitinden (`--roster-turk`/`--roster-transfers`) önce koşturma → oyuncunun takımı değişir, fark yutulur. Haber istemine kadro farkını "resmi açıklama" diye verme; ayrılışın nedeni bilinmez (`build_transfer`).
- Windows'ta Türkçe/Unicode içerikli heredoc ile dosya yazma → cp1254 karakterleri bozar.
- Windows'ta Python `open(p, 'w')` ile kaynak dosyası yazma → satır sonları CRLF olur, tüm dosya diff'e girer; `newline=''` ver.
- Sosyal videoda Inter dışında font kullanma → Baloo yalnız logoda.
- Sosyal paylaşım metnine 5'ten fazla hashtag koyma → Instagram ve TikTok en fazla 5'e izin veriyor (`radar.py` `MAKS_ETIKET`).
- Sır, metrik veya kişisel bilgi commit'leme → repo PUBLIC. Actions logları da herkese açık: iş akışında satır sayısı, boyut, e-posta ya da hata metni basma (`saglik.py`/`yedek.py` gövdeyi yalnız e-postaya ya da şifreli arşive yazar).
- Kullanıcının yazdığı yeni tabloya yalnız `auth.uid() = user_id` politikası koyma → takip için açılan anonim oturum da `authenticated`'dır; RESTRICTIVE `public.kayitli_oturum()` politikası ekle (`backend/sql/anonim_takip.sql`). İstemcide `useAuth().user` anonimi içermez, anonim kimlik `anonUserId`.
- `teams.game_id`'yi kontrolsüz yazma → `teams_name_game_unique (name, game_id)` var; aynı oyunda aynı adlı takım varsa yazım hata verir ve ETL'de maç kaydı da düşer (`sync_matches.py` `_get_or_create_team` önce bakar).
- Canlı DB'ye elle yazımı aynı psycopg bağlantısında doğrulama → ilk SELECT örtük işlem açar, `transaction()` savepoint olur, commit'siz kapanınca geri alınır ama aynı bağlantı "başarılı" okur; önce yedek, `with psycopg.connect()` (çıkışta COMMIT), sonra yeni bağlantıdan say.
- Tek kaydı `.single()` ile çekme → kayıt yoksa PostgREST 406 döner, konsolda kırmızı hata; `.maybeSingle()` + `if (!data)` "bulunamadı" (insert sonrası `.select().single()` doğru).
- Kartı/satırı `onClick` + `navigate` ile tıklanır yapma → orta tık, uzun bas → "linki kopyala" çalışmaz. `components/KartLink.jsx`: içinde düğme/link yoksa kart `KartLink`; varsa kartı kaplayan `KartOrtusu` + düğmelere `UST_KATMAN` (`<a>` içinde `<a>`/`<button>` olmaz). `UST_KATMAN`'lı öğenin atasına opacity/transform verme; kartın inline `position`'ını silen kod (ör. FLIP temizliği) örtüyü bütün listeye yayar.
- Takım aramasını `teams` üzerinde `ilike` + sırasız `limit` ile yazma → "eternal"de ana Eternal Fire çıkmıyordu; `utils/takimAra.js` (`takim_ara` RPC: tam/ön ek eşleşme, `ex-` sona, Türk takımı, önem puanı; Türkçe harf düzleşir). Popüler takımlar `populer_takimlar` (elle listeler SQL'de, `backend/sql/takim_arama.sql`).
- Satır başına çağrılan SQL yardımcı fonksiyonuna `SET search_path` koyma → Postgres satır içine açamaz, her satırda ayrı çağrı (aramada 6 → 35 ms); gövdede `pg_catalog.` öneki kullan (`arama_duz`).
- Kullanıcı tablosunu (`profiles`, `news_likes`) anon'a açma → herkese açık okuma dar görünümden (`profiles_public`, `news_like_counts`); yeni `security_invoker = false` görünümde `revoke all` + yalnız `grant select` şart, yoksa Supabase varsayılan yetkisi anon'a görünüm üzerinden RLS'siz yazma verir.
