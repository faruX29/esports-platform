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
- **Zamanlanmış işler:** GitHub Actions + Postgres içinde pg_cron
- **Sosyal video:** Pillow + imageio-ffmpeg

## Klasörler
- `backend/run.py`: ETL giriş noktası (tüm işler bayraklarla)
- `backend/etl/`: senkron (`sync_matches.py`, `sync_players.py`), tahmin (`predict.py`), haber (`news_generator.py`)
- `backend/etl/adapters/`: harici API adaptörleri
- `backend/sql/`: şema/RPC/göç dosyaları; Supabase'e **elle** uygulanır
- `frontend/src/pages/`: sayfalar · `components/` · `hooks/` · `utils/`
- `frontend/src/theme.js`: renk token'ları (tek kaynak) · `features.js`: özellik bayrakları
- `frontend/middleware.js`: Edge middleware; botlara prerender HTML basar (SEO)
- `frontend/api/`: Vercel fonksiyonları (`og.js` paylaşım görseli, `sitemap.js`)
- `social/`: sosyal medya video üreticileri; çıktı `social/cikti/` (gitignore)
- `.github/workflows/`: zamanlanmış ETL, içerik üretimi, günlük radar videosu

## Komutlar
```bash
# frontend
cd frontend && npm run dev | npm run build | npm run lint
# backend (cd backend)
python run.py --all-games --limit 100 --predict --stats   # maç senkronu + tahmin + istatistik
python run.py --live --all-games --limit 20 --fix-orphans # canlı maçlar + takılı kalanlar
python run.py --generate-news --news-hours 2              # haber üretimi
python run.py --help                                      # diğer tüm bayraklar
# sosyal (cd social)
python radar.py [YYYY-AA-GG] | python karne.py | python champions.py [grup] | python asama.py kazananlar
```

## Ortam değişkenleri (yalnız adlar; değerler `.env` ve GitHub Secrets'ta)
- backend: `DATABASE_URL` `PANDASCORE_TOKEN` `GEMINI_API_KEY` `RESEND_API_KEY` `SUPABASE_URL` `SUPABASE_SERVICE_KEY`
- frontend: `VITE_SUPABASE_URL` `VITE_SUPABASE_ANON_KEY` `VITE_TURNSTILE_SITE_KEY` `SITE_URL`
- Postgres Vault: `pandascore_token` (canlı senkron okur)

## Altyapı gerçekleri
- **Canlı skor** Postgres'te koşar: pg_cron `canli-senkron` dakikada bir (`backend/sql/canli_senkron.sql`). Sorun olursa: `cron.job_run_details`.
- **GitHub Actions kısa cron'ları eliyor:** `*/5` fiilen saatlerce gecikir. Sık iş için pg_cron kullan.
- **PandaScore:** saatte 1000 istek (`X-Rate-Limit-Remaining` başlığı).
- **Vercel ücretsiz CPU kotası** dar; middleware her istekte koşar, `api/og` pahalıdır.
- **Vercel CDN Requests** (Hobby: ayda 1M) bot dahil her isteği sayar; kotayı yiyen botu Firewall → Top User Agents'ta bul, custom rule'u UA **Contains** ile kur ("Matches expression" eşleşmedi) ve bot UA'lı curl'de 403 gör. Değersiz bot listesi `middleware.js` `DEGERSIZ_BOT_RE` ile `public/robots.txt`'te eş tutulur.
- `sync-liquipedia.yml` adı yanıltıcı: Liquipedia senkronu kapalı, iş akışı artık içerik (önizleme, turnuva özeti, transfer haberi) üretiyor.

## Kod kuralları
- UI metinleri ve kod yorumları Türkçe; çevredeki kodun dilini ve yoğunluğunu izle.
- **Yeni kodda inline stil kullan, mevcut kodla tutarlı ol. Tailwind kullanma.** Renkler `theme.js`'den.
- İkon `lucide-react`; UI'da emoji yok.
- Harici API çağrıları `backend/etl/adapters/` üzerinden; sessiz hata yok, her DB/API hatası loglanır.
- Yeni SQL `backend/sql/` altına, tekrar çalıştırılabilir (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Göreve ilgili klasörden başla, tüm projeyi tarama.

## Doğrulama (test YOK)
Projede otomatik test yok. Değişiklik şöyle doğrulanır:
- **Veri:** psycopg ile doğrudan sorgu (ör. kazanan–skor çelişkisi sayımı); düzeltmeden önce ve sonra say.
- **SEO/bot HTML:** Googlebot UA ile iste, `?__og=1&cb=<rastgele>` ekleyip önbelleği atla. `<title>` middleware'deki varsayılan kabuk başlığıysa sayfa bozuktur.
- **Frontend:** `npm run build` + `npm run lint`, sonra canlıda ekran görüntüsü.
- **Video:** ffmpeg ile kare çıkarıp bak.

## Asla yapma
- Skoru `results[]` sırasıyla yazma → `team_id` ile eşleştir; sıra `opponents[]` ile aynı değil, skorlar ters yazıldı.
- Maç güncellemesinde skoru takımlarsız yazma → takım ve skor birlikte güncellenir, yoksa satırlar kayar.
- Takımları satırdakiyle eşleşmeyen API yanıtıyla maçı güncelleme → yanlış maça skor yazılır.
- ETL/iş akışı adımını `timeout-minutes` olmadan ekleme → sınırsız adım tüm işi rehin alır.
- Liquipedia `api.php` kullanma → kullanım şartlarına aykırı.
- VLR.gg veya başka siteyi kazıma → izinsiz veri.
- Türkçe karakterli `replace`'ten sonra `assert` atlama → eşleşmezse sessizce hiçbir şey yapmaz.
- LLM'e anlamı/sırası yazılmamış dizi verme (ör. "LLWWW") → ters okur, yanlış haber üretir.
- Özel adları çevirtme ("VCT Champions" → "Şampiyonlar Ligi") → prompt'larda `_AD_KURALI` var.
- Doğrulanmamış tarih, saat veya sayı yazma → maç saatleri değişir, üretmeden önce DB'den tazele.
- UI'da "Model" ya da "AI" deme → tahmin motorunun adı Fextopus.
- Middleware yanıtına `s-maxage` koyup CPU'yu koruduğunu sanma → middleware önbellekten önce her istekte koşar.
- Türkçe yerelde İngilizce terimi büyük harfe çevirme → "WINNERS" "WİNNERS" olur.
- Windows'ta Türkçe/Unicode içerikli heredoc ile dosya yazma → cp1254 karakterleri bozar.
- Sosyal videoda Inter dışında font kullanma → Baloo yalnız logoda.
- Sır, metrik veya kişisel bilgi commit'leme → repo PUBLIC.
