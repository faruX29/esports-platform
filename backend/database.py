"""
Database connection manager using psycopg3
"""
import psycopg
from contextlib import contextmanager
from config import Config

class Database:
    """PostgreSQL database connection manager"""
    
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
            conn = psycopg.connect(
                Config.DATABASE_URL,
                connect_timeout=30
                )
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
            print(f"❌ Database connection failed: {e}")
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
    # Test connection
    if Database.test_connection():
        print("✅ Database connection successful!")
        
        # Test game lookup
        game_id = Database.get_game_id('valorant')
        print(f"✅ Valorant game_id: {game_id}")
    else:
        print("❌ Database connection failed!")