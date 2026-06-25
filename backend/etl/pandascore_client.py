"""
PandaScore API client for fetching esports match data
"""
import requests
import os
import time
from datetime import datetime, timedelta, timezone
import logging

logger = logging.getLogger(__name__)


class PandaScoreClient:
    """Client for interacting with PandaScore API"""
    
    def __init__(self):
        self.base_url = "https://api.pandascore.co"
        self.api_token = os.getenv('PANDASCORE_TOKEN')
        
        if not self.api_token:
            raise ValueError("PANDASCORE_TOKEN not found in environment variables")

    @staticmethod
    def _retry_delay_seconds(response, attempt, base_delay=2.0, max_delay=60.0):
        retry_after = response.headers.get('Retry-After') if response is not None else None
        if retry_after:
            try:
                return max(1.0, float(retry_after))
            except (TypeError, ValueError):
                pass

        delay = base_delay * (2 ** max(0, attempt - 1))
        return min(max_delay, delay)

    def _request_json_with_backoff(self, url, params, label, max_attempts=5, base_delay=2.0):
        last_response = None

        for attempt in range(1, max_attempts + 1):
            response = requests.get(url, params=params, timeout=30)
            last_response = response

            if response.status_code == 429:
                wait_seconds = self._retry_delay_seconds(response, attempt, base_delay=base_delay)
                logger.warning(
                    f"⚠️  {label} rate limited (attempt {attempt}/{max_attempts}); "
                    f"waiting {wait_seconds:.1f}s before retry..."
                )
                time.sleep(wait_seconds)
                continue

            response.raise_for_status()
            payload = response.json()
            logger.info(f"✅ {label} fetched {len(payload)} matches")
            return payload

        if last_response is not None and last_response.status_code == 429:
            logger.error(f"❌ {label} rate limited after {max_attempts} attempts")
            return None

        return None
    
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
            logger.info(f"📥 Fetching from PandaScore API: {game_slug} (next {days_ahead} days)")
            matches = self._request_json_with_backoff(
                url,
                params,
                f"PandaScore upcoming matches for {game_slug} (windowed)",
            )
            if matches is not None:
                logger.info(f"✅ Fetched {len(matches)} matches in date window")
                return matches
            
        except requests.exceptions.RequestException as e:
            logger.warning(f"⚠️  Windowed upcoming request failed: {e}")

        if params.get('range[begin_at]'):
            fallback_params = {
                'token': self.api_token,
                'per_page': limit,
                'sort': 'begin_at',
            }
            try:
                logger.info("↩️ Retrying upcoming fetch without range filter...")
                matches = self._request_json_with_backoff(
                    url,
                    fallback_params,
                    f"PandaScore upcoming matches for {game_slug} (fallback)",
                )
                if matches is not None:
                    logger.info(f"✅ Fetched {len(matches)} matches (fallback)")
                    return matches
            except requests.exceptions.RequestException as fallback_error:
                logger.error(f"❌ API request failed: {fallback_error}")
        return []
    
    def get_running_matches(self, game_slug, limit=50):
        """Fetch currently running (live) matches from PandaScore /running endpoint."""
        url = f"{self.base_url}/{game_slug}/matches/running"
        params = {
            'token': self.api_token,
            'per_page': limit,
        }
        try:
            logger.info(f"📡 Fetching live matches for {game_slug}...")
            matches = self._request_json_with_backoff(
                url, params, f"PandaScore running matches for {game_slug}"
            )
            return matches or []
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Running matches fetch failed for {game_slug}: {e}")
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
            logger.info(f"📥 Fetching past matches (page {page})")
            matches = self._request_json_with_backoff(
                url,
                params,
                f"PandaScore past matches page {page}",
            )
            if matches is not None:
                logger.info(f"✅ Fetched {len(matches)} past matches from page {page}")
                return matches
            
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ API request failed: {e}")
        return []