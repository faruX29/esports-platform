"""
AI Match Prediction Module
Uses weighted probability to predict match outcomes
"""
from database import Database
import psycopg


class MatchPredictor:
    """Predict match outcomes based on team performance"""
    
    def __init__(self):
        self.weight_recent = 0.6  # Son 5 maç (en önemli)
        self.weight_total = 0.3   # Tüm zamanlar
        self.weight_tier = 0.1    # Turnuva seviyesi
    
    def calculate_team_strength(self, team_id, tournament_tier=None):
        """
        Calculate team strength score
        
        Args:
            team_id: Team ID
            tournament_tier: Tournament tier (optional)
            
        Returns:
            float: Team strength score (0.0 - 1.0)
        """
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # Son 5 maçtaki win rate
                cur.execute("""
                    SELECT 
                        COUNT(*) as total_matches,
                        SUM(CASE WHEN winner_id = %s THEN 1 ELSE 0 END) as wins
                     FROM (
                    SELECT winner_id
                    FROM matches
                    WHERE (team_a_id = %s OR team_b_id = %s)
                        AND status = 'finished'
                        AND winner_id IS NOT NULL
                    ORDER BY scheduled_at DESC
                    LIMIT 5
                     ) recent_matches
                """, (team_id, team_id, team_id))
                
                recent = cur.fetchone()
                recent_wins = recent[1] if recent and recent[0] > 0 else 0
                recent_total = recent[0] if recent else 0
                recent_rate = recent_wins / recent_total if recent_total > 0 else 0.5
                
                # Tüm zamanların win rate
                cur.execute("""
                    SELECT 
                        COUNT(*) as total_matches,
                        SUM(CASE WHEN winner_id = %s THEN 1 ELSE 0 END) as wins
                    FROM matches
                    WHERE (team_a_id = %s OR team_b_id = %s)
                        AND status = 'finished'
                        AND winner_id IS NOT NULL
                """, (team_id, team_id, team_id))
                
                total = cur.fetchone()
                total_wins = total[1] if total and total[0] > 0 else 0
                total_matches = total[0] if total else 0
                total_rate = total_wins / total_matches if total_matches > 0 else 0.5
                
                # Tier bonus (normalized)
                tier_score = 0.5  # Default
                if tournament_tier:
                    tier_map = {
                        'S': 1.0,
                        'A': 0.8,
                        'B': 0.6,
                        'C': 0.4
                    }
                    tier_score = tier_map.get(tournament_tier, 0.5)
                
                # Gemini'nin formülü
                strength = (
                    recent_rate * self.weight_recent +
                    total_rate * self.weight_total +
                    tier_score * self.weight_tier
                )
                
                return strength
    
    def predict_match(self, match_id):
        """
        Predict match outcome
        
        Args:
            match_id: Match ID
            
        Returns:
            dict: Prediction results
        """
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # Maç bilgilerini al
                cur.execute("""
                    SELECT 
                        m.id,
                        m.team_a_id,
                        m.team_b_id,
                        t.tier
                    FROM matches m
                    LEFT JOIN tournaments t ON m.tournament_id = t.id
                    WHERE m.id = %s
                """, (match_id,))
                
                match = cur.fetchone()
                if not match:
                    return None
                
                match_id, team_a_id, team_b_id, tier = match
                
                # Takım güçlerini hesapla
                strength_a = self.calculate_team_strength(team_a_id, tier)
                strength_b = self.calculate_team_strength(team_b_id, tier)
                
                # Normalize (toplam = 1.0)
                total_strength = strength_a + strength_b
                if total_strength > 0:
                    prob_a = strength_a / total_strength
                    prob_b = strength_b / total_strength
                else:
                    prob_a = 0.5
                    prob_b = 0.5
                
                # Güvenilirlik (fark ne kadar büyükse o kadar güvenilir)
                confidence = abs(prob_a - prob_b)
                
                # Database'e kaydet
                cur.execute("""
                    UPDATE matches
                    SET 
                        prediction_team_a = %s,
                        prediction_team_b = %s,
                        prediction_confidence = %s
                    WHERE id = %s
                """, (prob_a, prob_b, confidence, match_id))
                
                conn.commit()
                
                return {
                    'match_id': match_id,
                    'team_a_prob': prob_a,
                    'team_b_prob': prob_b,
                    'confidence': confidence,
                    'strength_a': strength_a,
                    'strength_b': strength_b
                }
    
    def predict_upcoming_matches(self, limit=50):
        """
        Predict all upcoming matches
        
        Args:
            limit: Maximum number of matches to predict
            
        Returns:
            list: Prediction results
        """
        predictions = []
        
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # Upcoming maçları al
                cur.execute("""
                    SELECT id
                    FROM matches
                    WHERE status = 'not_started'
                    AND scheduled_at > NOW()
                    ORDER BY scheduled_at ASC
                    LIMIT %s
                """, (limit,))
                
                matches = cur.fetchall()
                
                for match in matches:
                    match_id = match[0]
                    try:
                        result = self.predict_match(match_id)
                        if result:
                            predictions.append(result)
                            print(f"✅ Predicted match {match_id}: Team A {result['team_a_prob']:.1%} vs Team B {result['team_b_prob']:.1%}")
                            conn.commit()
                    except Exception as e:
                        print(f"⚠️  Error predicting match {match_id}: {e}")
                        continue
        
        return predictions