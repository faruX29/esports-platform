"""
PandaScore API client for fetching esports match data
"""
import requests
import os


class PandaScoreClient:
    """Client for interacting with PandaScore API"""
    
    def __init__(self):
        self.base_url = "https://api.pandascore.co"
        self.api_token = os.getenv('PANDASCORE_TOKEN')
        
        if not self.api_token:
            raise ValueError("PANDASCORE_TOKEN not found in environment variables")
    
    def get_upcoming_matches(self, game_slug, limit=50):
        """
        Fetch upcoming matches from PandaScore API
        
        Args:
            game_slug: Game identifier (valorant, csgo, lol)
            limit: Maximum number of matches to fetch
        
        Returns:
            list: List of match data
        """
        url = f"{self.base_url}/{game_slug}/matches/upcoming"
        
        params = {
            'token': self.api_token,
            'per_page': limit,
            'sort': 'begin_at'
        }
        
        try:
            print(f"📥 Fetching from PandaScore API: {game_slug}")
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            
            matches = response.json()
            print(f"✅ Fetched {len(matches)} matches")
            return matches
            
        except requests.exceptions.RequestException as e:
            print(f"❌ API request failed: {e}")
            return []
    
    def get_past_matches(self, game_slug, limit=50, page=1):
        """
        Fetch past (finished) matches from PandaScore API
        
        Args:
            game_slug: Game identifier (valorant, csgo, lol)
            limit: Maximum number of matches to fetch
            page: Page number for pagination (default: 1)
        
        Returns:
            list: List of past match data
        """
        url = f"{self.base_url}/{game_slug}/matches/past"
        
        params = {
            'token': self.api_token,
            'per_page': limit,
            'page': page,
            'sort': '-begin_at'
        }
        
        try:
            print(f"📥 Fetching past matches (page {page})")
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            
            matches = response.json()
            print(f"✅ Fetched {len(matches)} past matches from page {page}")
            return matches
            
        except requests.exceptions.RequestException as e:
            print(f"❌ API request failed: {e}")
            return []