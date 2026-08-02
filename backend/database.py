"""
Database connection manager using psycopg3
"""
import time
import psycopg
import logging
from contextlib import contextmanager
from config import Config

logger = logging.getLogger(__name__)

# Supabase pooler ara sıra geçici bağlantı timeout'u veriyor (GitHub Actions'tan
# ~%0.3 run). Kalıcı sorun değil → üstel backoff ile birkaç kez yeniden dene ki
# bu blip'ler kendiliğinden düzelsin. Toplam en kötü ~75s (4dk step timeout'a sığar).
_CONNECT_ATTEMPTS = 4
_CONNECT_TIMEOUT = 15   # saniye/deneme
_BACKOFF_BASE = 2       # bekleme: 2s, 4s, 8s

class Database:
    """PostgreSQL database connection manager"""

    @staticmethod
    def _connect_with_retry():
        """Geçici bağlantı hatalarında üstel backoff ile yeniden dener."""
        last_err = None
        for attempt in range(_CONNECT_ATTEMPTS):
            try:
                return psycopg.connect(
                    Config.DATABASE_URL,
                    connect_timeout=_CONNECT_TIMEOUT,
                )
            except psycopg.OperationalError as e:  # ConnectionTimeout dahil
                last_err = e
                if attempt < _CONNECT_ATTEMPTS - 1:
                    delay = _BACKOFF_BASE * (2 ** attempt)
                    logger.warning(
                        f"⚠️ DB bağlantısı başarısız (deneme {attempt + 1}/{_CONNECT_ATTEMPTS}), "
                        f"{delay}s sonra tekrar: {e}"
                    )
                    time.sleep(delay)
        logger.error(f"❌ DB bağlantısı {_CONNECT_ATTEMPTS} denemede kurulamadı: {last_err}")
        raise last_err

    @staticmethod
    @contextmanager
    def get_connection():
        """
        Context manager for database connections
        Automatically commits on success, rolls back on error

        Usage:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM teams")
        """
        conn = None
        try:
            conn = Database._connect_with_retry()
            yield conn
            conn.commit()
        except Exception as e:
            if conn:
                conn.rollback()
            raise e
        finally:
            if conn:
                conn.close()
    
    @staticmethod
    def test_connection():
        """Test database connection"""
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    result = cur.fetchone()
                    return result[0] == 1
        except Exception as e:
            logger.error(f"❌ Database connection failed: {e}")
            return False
    
    @staticmethod
    def get_game_id(game_slug: str):
        """Get game ID by slug"""
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM games WHERE slug = %s",
                    (game_slug,)
                )
                result = cur.fetchone()
                return result[0] if result else None

if __name__ == "__main__":
    from utils.logger import setup_logging
    setup_logging()
    if Database.test_connection():
        logger.info("✅ Database connection successful!")
        game_id = Database.get_game_id('valorant')
        logger.info(f"✅ Valorant game_id: {game_id}")
    else:
        logger.error("❌ Database connection failed!")