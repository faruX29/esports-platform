"""
Data cleaning and validation for PandaScore API responses
"""
from typing import Dict, Optional, List
from datetime import datetime

class DataCleaner:
    """Clean and validate data from PandaScore API"""
    
    @staticmethod
    def clean_match(raw_match: Dict) -> Optional[Dict]:
        """
        Clean and validate a single match
        
        Returns None if match is invalid (missing required fields)
        Returns cleaned dict if valid
        """
        # CRITICAL: Must have exactly 2 opponents
        opponents = raw_match.get('opponents', [])
        if len(opponents) != 2:
            return None
        
        # CRITICAL: Must have scheduled time
        scheduled_at = raw_match.get('scheduled_at') or raw_match.get('begin_at')
        if not scheduled_at:
            return None
        
        # Extract teams
        team_a = opponents[0].get('opponent', {})
        team_b = opponents[1].get('opponent', {})
        
        # Teams must have IDs
        if not team_a.get('id') or not team_b.get('id'):
            return None
        
        # Map PandaScore status to our status
        status_map = {
            'not_started': 'not_started',
            'running': 'running',
            'finished': 'finished',
            'canceled': 'canceled',
            'postponed': 'postponed'
        }
        status = status_map.get(raw_match.get('status'), 'not_started')
        
        # Extract game info
        videogame = raw_match.get('videogame', {})
        game_slug = videogame.get('slug', 'unknown')
        
        # Extract tournament info
        tournament = raw_match.get('tournament', {})
        
        # Build clean match object
        clean_match = {
            'id': raw_match['id'],
            'game_slug': game_slug,
            'tournament': {
                'id': tournament.get('id'),
                'name': tournament.get('name', 'Unknown Tournament'),
                'slug': tournament.get('slug'),
                'tier': tournament.get('tier')
            },
            'teams': {
                'team_a': {
                    'id': team_a['id'],
                    'name': team_a.get('name', 'Unknown Team'),
                    'slug': team_a.get('slug'),
                    'acronym': team_a.get('acronym', ''),
                    'logo_url': team_a.get('image_url')
                },
                'team_b': {
                    'id': team_b['id'],
                    'name': team_b.get('name', 'Unknown Team'),
                    'slug': team_b.get('slug'),
                    'acronym': team_b.get('acronym', ''),
                    'logo_url': team_b.get('image_url')
                }
            },
            'scheduled_at': scheduled_at,
            'status': status,
            'match_type': raw_match.get('match_type', 'best_of'),
            'number_of_games': raw_match.get('number_of_games', 1),
            'winner_id': raw_match.get('winner_id'),
            'raw_data': raw_match  # Keep original for debugging
        }
        
        return clean_match
    
    @staticmethod
    def clean_matches(raw_matches: List[Dict]) -> List[Dict]:
        """
        Clean a list of matches, filtering out invalid ones
        
        Args:
            raw_matches: List of raw match dicts from API
        
        Returns:
            List of cleaned match dicts (only valid ones)
        """
        cleaned = []
        skipped = 0
        
        for raw_match in raw_matches:
            clean = DataCleaner.clean_match(raw_match)
            if clean:
                cleaned.append(clean)
            else:
                skipped += 1
        
        if skipped > 0:
            print(f"⚠️  Skipped {skipped} invalid matches (missing teams or schedule)")
        
        return cleaned

if __name__ == "__main__":
    # Test with sample data
    sample_match = {
        'id': 123456,
        'status': 'not_started',
        'scheduled_at': '2026-01-25T15:00:00Z',
        'videogame': {'slug': 'valorant'},
        'tournament': {
            'id': 789,
            'name': 'VCT Masters',
            'slug': 'vct-masters'
        },
        'opponents': [
            {
                'opponent': {
                    'id': 1001,
                    'name': 'Team Liquid',
                    'acronym': 'TL',
                    'image_url': 'https://example.com/tl.png'
                }
            },
            {
                'opponent': {
                    'id': 1002,
                    'name': 'Fnatic',
                    'acronym': 'FNC',
                    'image_url': 'https://example.com/fnc.png'
                }
            }
        ]
    }
    
    print("🧹 Testing data cleaner...")
    cleaned = DataCleaner.clean_match(sample_match)
    
    if cleaned:
        print("✅ Match cleaned successfully!")
        print(f"   Match ID: {cleaned['id']}")
        print(f"   Teams: {cleaned['teams']['team_a']['name']} vs {cleaned['teams']['team_b']['name']}")
        print(f"   Tournament: {cleaned['tournament']['name']}")
    else:
        print("❌ Match cleaning failed")