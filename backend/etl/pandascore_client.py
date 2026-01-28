"""
PandaScore API client wrapper
"""
import requests
from typing import List, Dict, Optional
from config import Config

class PandaScoreClient:
    """Wrapper for PandaScore API"""
    
    def __init__(self):
        self.base_url = Config.PANDASCORE_BASE_URL
        self.token = Config.PANDASCORE_TOKEN
        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'Accept': 'application/json'
        }
    
    def _make_request(self, endpoint: str, params: Dict = None) -> Optional[List[Dict]]:
        """
        Make HTTP request to PandaScore API
        
        Args:
            endpoint: API endpoint (e.g., '/valorant/matches/upcoming')
            params: Query parameters
        
        Returns:
            List of results or None on error
        """
        url = f"{self.base_url}{endpoint}"
        
        # Add token to params
        if params is None:
            params = {}
        params['token'] = self.token
        
        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"❌ API request failed: {e}")
            return None
    
    def get_upcoming_matches(self, game_slug: str, per_page: int = 50) -> List[Dict]:
        """
        Get upcoming matches for a specific game
        
        Args:
            game_slug: Game identifier ('valorant', 'cs-go', 'lol')
            per_page: Number of results per page (max 100)
        
        Returns:
            List of match dictionaries
        """
        endpoint = f"/{game_slug}/matches/upcoming"
        params = {
            'per_page': min(per_page, 100),
            'sort': 'begin_at'  # Sort by start time
        }
        
        matches = self._make_request(endpoint, params)
        return matches if matches else []
    
    def get_running_matches(self, game_slug: str, per_page: int = 50) -> List[Dict]:
        """Get currently running matches"""
        endpoint = f"/{game_slug}/matches/running"
        params = {'per_page': min(per_page, 100)}
        
        matches = self._make_request(endpoint, params)
        return matches if matches else []
    
    def get_past_matches(self, game_slug: str, per_page: int = 50) -> List[Dict]:
        """Get past matches"""
        endpoint = f"/{game_slug}/matches/past"
        params = {
            'per_page': min(per_page, 100),
            'sort': '-begin_at'  # Sort by most recent first
        }
        
        matches = self._make_request(endpoint, params)
        return matches if matches else []

if __name__ == "__main__":
    # Test the client
    client = PandaScoreClient()
    
    print("🔍 Fetching Valorant upcoming matches...")
    matches = client.get_upcoming_matches('valorant', per_page=5)
    
    if matches:
        print(f"✅ Found {len(matches)} matches")
        for match in matches[:3]:
            team_a = match['opponents'][0]['opponent']['name'] if len(match.get('opponents', [])) > 0 else 'TBD'
            team_b = match['opponents'][1]['opponent']['name'] if len(match.get('opponents', [])) > 1 else 'TBD'
            print(f"  📅 {match.get('scheduled_at', 'No time')}: {team_a} vs {team_b}")
    else:
        print("❌ No matches found")