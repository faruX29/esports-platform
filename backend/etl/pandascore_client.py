"""
PandaScore API client for fetching esports match data
"""
import requests
import os
from datetime import datetime, timedelta, timezone


class PandaScoreClient:
    """Client for interacting with PandaScore API"""
    
    def __init__(self):
        self.base_url = "https://api.pandascore.co"
        self.api_token = os.getenv('PANDASCORE_TOKEN')
        
        if not self.api_token:
            raise ValueError("PANDASCORE_TOKEN not found in environment variables")
    
    def get_upcoming_matches(self, game_slug, limit=50, days_ahead=7):
        """
        Fetch upcoming matches from PandaScore API
        
        Args:
            game_slug: Game identifier (valorant, csgo, lol)
            limit: Maximum number of matches to fetch
            days_ahead: Date window for upcoming matches (default: 7 days)
        
        Returns:
            list: List of match data
        """
        url = f"{self.base_url}/{game_slug}/matches/upcoming"

        now_utc = datetime.now(timezone.utc).replace(microsecond=0)
        until_utc = now_utc + timedelta(days=max(1, int(days_ahead or 7)))
        now_iso = now_utc.isoformat().replace('+00:00', 'Z')
        until_iso = until_utc.isoformat().replace('+00:00', 'Z')
        
        params = {
            'token': self.api_token,
            'per_page': limit,
            'sort': 'begin_at',
            'range[begin_at]': f'{now_iso},{until_iso}',
        }
        
        try:
            print(f"📥 Fetching from PandaScore API: {game_slug} (next {days_ahead} days)")
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()

            matches = response.json()
            print(f"✅ Fetched {len(matches)} matches in date window")
            return matches
            
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Windowed upcoming request failed: {e}")
            fallback_params = {
                'token': self.api_token,
                'per_page': limit,
                'sort': 'begin_at',
            }
            try:
                print("↩️ Retrying upcoming fetch without range filter...")
                response = requests.get(url, params=fallback_params, timeout=30)
                response.raise_for_status()
                matches = response.json()
                print(f"✅ Fetched {len(matches)} matches (fallback)")
                return matches
            except requests.exceptions.RequestException as fallback_error:
                print(f"❌ API request failed: {fallback_error}")
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
    'sort': '-begin_at',
    'filter[status]': 'finished'  # YENİ! Sadece finished maçlar
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