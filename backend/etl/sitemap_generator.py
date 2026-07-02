"""
Dinamik SEO sitemap üretici.

Google'ın binlerce maç/takım/oyuncu/turnuva/haber sayfasını keşfedebilmesi için
DB'den mutlak URL'ler üretir. Çıktı: frontend/public/ altına bir sitemap index
(sitemap.xml) + tipe göre alt-sitemap'ler (sitemap-news.xml, sitemap-matches.xml, ...).

Google limitleri: dosya başına ≤50.000 URL, ≤50MB. Büyüyen tablolar (matches) için
her tip otomatik olarak 45.000'lik parçalara bölünür (sitemap-matches-1.xml, -2.xml ...).

Kanonik URL'ler frontend route'larıyla birebir eşleşir (App.jsx):
  /                     /matches  /tournaments  /rankings  /players  /news  /scout
  /match/<id>  /team/<id>  /tournament/<id>  /player/<uuid>
  /news/<seo-slug>   (slug = slugify(title)-<matchId | transfer_uuid>, newsSlug.js ile birebir)
"""
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from config import Config
from database import Database

logger = logging.getLogger(__name__)

# frontend/public — Vite bu klasörü olduğu gibi build köküne kopyalar.
PUBLIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public"

URLS_PER_FILE = 45000  # 50k limitinin altında güvenli tavan

# newsSlug.js slugify() ile birebir (Türkçe karakter haritası dahil)
_TR_MAP = {"ç": "c", "ğ": "g", "ı": "i", "İ": "i", "ö": "o", "ş": "s", "ü": "u"}


def _slugify(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"[çğıİöşüÇĞÖŞÜ]", lambda m: _TR_MAP.get(m.group(0), _TR_MAP.get(m.group(0).lower(), m.group(0))), s)
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)
    return s[:70]


def _news_slug(row: dict) -> str:
    """news_articles satırından SEO slug üretir (newsSlug.js buildNewsSlug ile aynı)."""
    if row["content_type"] == "transfer":
        story_id = f"transfer_{row['id']}"
        title_slug = _slugify(row["title"])
        return f"{title_slug}-{story_id}" if title_slug else story_id
    match_id = row.get("match_id")
    if not match_id:
        return f"match_{row['id']}"
    title_slug = _slugify(row["title"])
    return f"{title_slug}-{match_id}" if title_slug else str(match_id)


def _lastmod(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
    return None


class SitemapGenerator:
    """DB'den dinamik sitemap index + alt-sitemap'ler üretir."""

    def __init__(self):
        self.base = Config.SITE_URL
        PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ helpers
    def _url_tag(self, loc: str, lastmod: str | None, changefreq: str, priority: str) -> str:
        parts = [f"<loc>{escape(self.base + loc)}</loc>"]
        if lastmod:
            parts.append(f"<lastmod>{lastmod}</lastmod>")
        parts.append(f"<changefreq>{changefreq}</changefreq>")
        parts.append(f"<priority>{priority}</priority>")
        return "  <url>" + "".join(parts) + "</url>"

    def _write_urlset(self, filename: str, url_tags: list[str]) -> str:
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(url_tags)
            + "\n</urlset>\n"
        )
        (PUBLIC_DIR / filename).write_text(body, encoding="utf-8")
        return filename

    def _write_chunked(self, prefix: str, url_tags: list[str]) -> list[str]:
        """Bir tipin URL'lerini 45k'lık dosyalara böler, üretilen dosya adlarını döner."""
        if not url_tags:
            return []
        if len(url_tags) <= URLS_PER_FILE:
            return [self._write_urlset(f"{prefix}.xml", url_tags)]
        files = []
        for i in range(0, len(url_tags), URLS_PER_FILE):
            idx = i // URLS_PER_FILE + 1
            chunk = url_tags[i : i + URLS_PER_FILE]
            files.append(self._write_urlset(f"{prefix}-{idx}.xml", chunk))
        return files

    # ------------------------------------------------------------------ sections
    def _static(self) -> list[str]:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        pages = [
            ("/", "daily", "1.0"),
            ("/matches", "daily", "0.9"),
            ("/news", "daily", "0.9"),
            ("/news/archive", "daily", "0.8"),
            ("/tournaments", "daily", "0.8"),
            ("/rankings", "weekly", "0.8"),
            ("/players", "weekly", "0.7"),
            ("/scout", "monthly", "0.6"),
        ]
        return [self._url_tag(loc, today, cf, pr) for loc, cf, pr in pages]

    def _news(self, cur) -> list[str]:
        cur.execute(
            "SELECT id, match_id, title, content_type, created_at FROM news_articles ORDER BY created_at DESC"
        )
        tags = []
        for _id, match_id, title, content_type, created_at in cur.fetchall():
            slug = _news_slug({"id": _id, "match_id": match_id, "title": title, "content_type": content_type})
            tags.append(self._url_tag(f"/news/{slug}", _lastmod(created_at), "weekly", "0.8"))
        return tags

    def _matches(self, cur) -> list[str]:
        # Sadece bitmiş maçlar: sonuç + istatistik = kalıcı (evergreen) içerik.
        cur.execute(
            "SELECT id, COALESCE(updated_at, created_at) FROM matches "
            "WHERE status = 'finished' ORDER BY scheduled_at DESC"
        )
        return [self._url_tag(f"/match/{mid}", _lastmod(lm), "monthly", "0.6") for mid, lm in cur.fetchall()]

    def _teams(self, cur) -> list[str]:
        cur.execute("SELECT id, COALESCE(updated_at, created_at) FROM teams ORDER BY updated_at DESC NULLS LAST")
        return [self._url_tag(f"/team/{tid}", _lastmod(lm), "weekly", "0.6") for tid, lm in cur.fetchall()]

    def _players(self, cur) -> list[str]:
        cur.execute("SELECT id, created_at FROM players ORDER BY created_at DESC NULLS LAST")
        return [self._url_tag(f"/player/{pid}", _lastmod(lm), "weekly", "0.5") for pid, lm in cur.fetchall()]

    def _tournaments(self, cur) -> list[str]:
        cur.execute("SELECT id, COALESCE(updated_at, created_at) FROM tournaments ORDER BY updated_at DESC NULLS LAST")
        return [self._url_tag(f"/tournament/{tid}", _lastmod(lm), "weekly", "0.6") for tid, lm in cur.fetchall()]

    # ------------------------------------------------------------------ index
    def _write_index(self, child_files: list[str]) -> None:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        entries = "\n".join(
            f"  <sitemap><loc>{escape(f'{self.base}/{f}')}</loc><lastmod>{now}</lastmod></sitemap>"
            for f in child_files
        )
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + entries
            + "\n</sitemapindex>\n"
        )
        (PUBLIC_DIR / "sitemap.xml").write_text(body, encoding="utf-8")

    def _update_robots(self) -> None:
        robots = PUBLIC_DIR / "robots.txt"
        lines = [
            "User-agent: *",
            "Allow: /",
            "",
            f"Sitemap: {self.base}/sitemap.xml",
            "",
        ]
        robots.write_text("\n".join(lines), encoding="utf-8")

    # ------------------------------------------------------------------ run
    def generate(self) -> dict:
        logger.info(f"🗺️  Sitemap üretiliyor (base: {self.base})...")
        child_files: list[str] = []
        counts: dict[str, int] = {}

        # statik
        static_tags = self._static()
        child_files += self._write_chunked("sitemap-static", static_tags)
        counts["static"] = len(static_tags)

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                for name, builder, prio_order in [
                    ("news", self._news, 0),
                    ("matches", self._matches, 1),
                    ("tournaments", self._tournaments, 2),
                    ("teams", self._teams, 3),
                    ("players", self._players, 4),
                ]:
                    tags = builder(cur)
                    child_files += self._write_chunked(f"sitemap-{name}", tags)
                    counts[name] = len(tags)
                    logger.info(f"   • {name}: {len(tags)} URL")

        self._write_index(child_files)
        self._update_robots()

        total = sum(counts.values())
        logger.info(f"✅ Sitemap tamam — {total} URL, {len(child_files)} dosya → {PUBLIC_DIR}")
        counts["_total"] = total
        counts["_files"] = len(child_files)
        return counts


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    SitemapGenerator().generate()
    sys.exit(0)
