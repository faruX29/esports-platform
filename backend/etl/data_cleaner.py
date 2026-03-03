"""
Data cleaning and validation for esports match data
"""


class DataCleaner:
    """Clean and validate match data from PandaScore API"""
    
    @staticmethod
    def clean_match_data(match):
        """
        Clean and validate a single match
        
        Args:
            match: Raw match data from API
            
        Returns:
            dict: Cleaned match data or None if invalid
        """
        # Required fields check
        if not match.get('id'):
            return None
            
        if not match.get('opponents') or len(match['opponents']) < 2:
            return None
            
        if not match.get('scheduled_at') and not match.get('begin_at'):
            return None
        
        # Extract opponents
        team_a = match['opponents'][0].get('opponent', {})
        team_b = match['opponents'][1].get('opponent', {})
        
        if not team_a.get('id') or not team_b.get('id'):
            return None
        
        # Get scores (for past matches)
        team_a_score = None
        team_b_score = None
        
        if match.get('results'):
            results = match['results']
            if len(results) >= 2:
                team_a_score = results[0].get('score')
                team_b_score = results[1].get('score')
        
        # Build cleaned data
        cleaned = {
            'id': match['id'],
            'scheduled_at': match.get('scheduled_at') or match.get('begin_at'),
            'status': match.get('status', 'not_started'),
            'game_slug': match.get('videogame', {}).get('slug'),
            'team_a_id': team_a['id'],
            'team_a_name': team_a.get('name', 'Unknown'),
            'team_a_acronym': team_a.get('acronym'),
            'team_a_logo': team_a.get('image_url'),
            'team_a_score': team_a_score,
            'team_b_id': team_b['id'],
            'team_b_name': team_b.get('name', 'Unknown'),
            'team_b_acronym': team_b.get('acronym'),
            'team_b_logo': team_b.get('image_url'),
            'team_b_score': team_b_score,
            'tournament_id': match.get('tournament_id') or match.get('league', {}).get('id'),
            'tournament_name': match.get('tournament', {}).get('name') or match.get('league', {}).get('name'),
            'serie_id': match.get('serie_id'),
            'winner_id': match.get('winner_id'),
            'raw_data': match
        }
        
        return cleaned
    
    @staticmethod
    def clean_matches(matches):
        """
        Clean and validate multiple matches
        
        Args:
            matches: List of raw match data
            
        Returns:
            list: List of cleaned match data
        """
        cleaned_matches = []
        skipped_count = 0
        
        for match in matches:
            cleaned = DataCleaner.clean_match_data(match)
            if cleaned:
                cleaned_matches.append(cleaned)
            else:
                skipped_count += 1
        
        if skipped_count > 0:
            print(f"⚠️  Skipped {skipped_count} invalid matches (missing teams or schedule)")
        
        print(f"✅ Cleaned {len(cleaned_matches)} valid matches")
        return cleaned_matches

    def clean_match(self, raw):
        """Clean a single match from PandaScore API response."""
        # ...existing code...

        # ── Tournament bilgisi ──────────────────────────────────────
        tournament    = raw.get('tournament') or {}
        league        = raw.get('league')     or {}
        serie         = raw.get('serie')      or {}

        # begin_at hiyerarşi: tournament > serie > league
        t_begin = (
            tournament.get('begin_at') or
            serie.get('begin_at')      or
            league.get('begin_at')
        )
        t_end = (
            tournament.get('end_at') or
            serie.get('end_at')      or
            league.get('end_at')
        )

        # tier: PandaScore'da league.tier veya tournament.tier
        t_tier   = tournament.get('tier') or league.get('tier')
        t_region = league.get('region') or tournament.get('region')

        # Tier normalize et:
        # PandaScore: 'S', 'A', 'B', 'C' veya 's_tier', 'a_tier' gibi gelebilir
        if t_tier:
            t_tier = t_tier.upper().replace('_TIER', '').strip()
            if t_tier not in ('S', 'A', 'B', 'C'):
                t_tier = None   # bilinmeyen tier'ları DROP et

        return {
            # ...existing fields...
            'tournament_id':       tournament.get('id') or raw.get('tournament_id'),
            'tournament_name':     tournament.get('name') or raw.get('league_name', ''),
            'tournament_begin_at': t_begin,
            'tournament_end_at':   t_end,
            'tournament_tier':     t_tier,
            'tournament_region':   t_region,
            # ...existing fields...
        }