"""
Configuration management for Esports Data Platform
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """Application configuration"""
    
    # PandaScore API
    PANDASCORE_TOKEN = os.getenv('PANDASCORE_TOKEN')
    PANDASCORE_BASE_URL = os.getenv('PANDASCORE_BASE_URL', 'https://api.pandascore.co')
    
    # Database
    DATABASE_URL = os.getenv('DATABASE_URL')
    
    # ETL
    BATCH_SIZE = int(os.getenv('BATCH_SIZE', 50))
    
    @classmethod
    def validate(cls):
        """Validate required config"""
        required = ['PANDASCORE_TOKEN', 'DATABASE_URL']
        missing = [key for key in required if not getattr(cls, key)]
        
        if missing:
            raise ValueError(f"Missing required config: {', '.join(missing)}")
        
        return True

# Validate on import
Config.validate()