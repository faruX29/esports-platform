"""Riot API adapter foundation for match-history level enrichment."""

from __future__ import annotations

import hashlib
import os
import time
from typing import Any, Dict, List, Optional

import requests

from etl.adapters.base_adapter import BaseDataAdapter


class RiotAdapter(BaseDataAdapter):
    """Riot adapter with public-signal + deterministic mock fallback metrics."""

    source_name = "riot"

    def __init__(self) -> None:
        self.api_key = os.getenv("RIOT_API_KEY", "")
        self.region = os.getenv("RIOT_REGION", "europe")
        self.enabled = True
        self._public_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ttl_seconds = 60 * 30

    def ensure_schema(self) -> None:
        # Foundation stage: Riot-specific schema migration is deferred.
        return None

    def enrich_tournaments(self, limit: int = 50) -> Dict[str, int]:
        return {"processed": 0, "updated": 0, "skipped": 0}

    def enrich_teams(self, limit: int = 50) -> Dict[str, int]:
        return {"processed": 0, "updated": 0, "skipped": 0}

    def enrich_players(self, limit: int = 50) -> Dict[str, int]:
        return {"processed": 0, "updated": 0, "skipped": 0}

    def run(self, limit: int = 50, sections: tuple[str, ...] = ("all",)) -> Dict[str, Dict[str, int]]:
        return {
            "status": {
                "processed": 0,
                "updated": 0,
                "skipped": 0,
                "enabled": 1,
            }
        }

    def fetch_match_history(self, context: Dict[str, Any], limit: int = 5) -> List[Dict[str, Any]]:
        """Return player-level mock/public metrics for LoL and Valorant contexts."""
        if not context:
            return []

        game_slug = str(context.get("game_slug") or "").strip().lower()
        if game_slug not in {"lol", "valorant"}:
            return []

        player_rows = self._extract_players(context)
        if not player_rows:
            return []

        public_signal = self._public_signal(game_slug)
        max_rows = max(1, int(limit or 5))

        metrics: List[Dict[str, Any]] = []
        for player in player_rows[:max_rows]:
            metrics.append(self._build_player_metric(player, context, public_signal))
        return metrics

    def fetch_match_detail(
        self,
        context: Dict[str, Any],
        external_match_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Return summary payload shaped for aggregator ingestion."""
        history = self.fetch_match_history(context=context, limit=10)
        if not history:
            return None

        avg_kda = sum(float(row.get("kda") or 0) for row in history) / len(history)
        avg_hs = sum(float(row.get("hs_pct") or 0) for row in history) / len(history)
        avg_wr = sum(float(row.get("win_rate") or 0) for row in history) / len(history)

        return {
            "provider": "riot_public_or_mock",
            "provider_mode": "api_key" if self.api_key else "public_mock",
            "external_match_id": external_match_id,
            "player_metrics": history,
            "summary": {
                "avg_kda": round(avg_kda, 2),
                "avg_hs_pct": round(avg_hs, 2),
                "avg_win_rate": round(avg_wr, 2),
            },
        }

    def _extract_players(self, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        raw_match = context.get("raw_match") or {}
        players: List[Dict[str, Any]] = []
        seen = set()

        opponents = raw_match.get("opponents") or []
        for op in opponents:
            team = (op or {}).get("opponent") or {}
            team_name = str(team.get("name") or "Unknown Team")
            for player in team.get("players") or []:
                player_id = player.get("id") or player.get("player_id")
                player_name = str(player.get("name") or player.get("nickname") or "").strip()
                if not player_name:
                    continue
                dedupe = (player_id, player_name.casefold())
                if dedupe in seen:
                    continue
                seen.add(dedupe)
                players.append({
                    "player_id": player_id,
                    "player_name": player_name,
                    "team_name": team_name,
                    "team_id": team.get("id"),
                })

        if players:
            return players

        team_names = context.get("team_names") or ["Team A", "Team B"]
        for team_idx, team_name in enumerate(team_names[:2], start=1):
            base_name = str(team_name or f"Team {team_idx}").strip() or f"Team {team_idx}"
            for player_idx in range(1, 6):
                synthetic_name = f"{base_name} P{player_idx}"
                synthetic_id = int(hashlib.sha1(synthetic_name.encode("utf-8")).hexdigest()[:8], 16)
                players.append({
                    "player_id": synthetic_id,
                    "player_name": synthetic_name,
                    "team_name": base_name,
                    "team_id": None,
                })

        return players

    def _build_player_metric(
        self,
        player: Dict[str, Any],
        context: Dict[str, Any],
        public_signal: float,
    ) -> Dict[str, Any]:
        seed_parts = [
            str(context.get("match_id") or ""),
            str(context.get("game_slug") or ""),
            str(player.get("player_id") or ""),
            str(player.get("player_name") or ""),
            str(player.get("team_name") or ""),
        ]
        seed = "|".join(seed_parts)
        digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
        h = int(digest[:8], 16)

        kda = 0.9 + ((h % 215) / 100)
        hs_pct = 18 + (((h >> 3) % 4700) / 100)
        win_rate = 37 + (((h >> 7) % 4300) / 100)

        # Public endpoints contribute a soft signal so metrics vary by live ecosystem state.
        kda += public_signal * 0.04
        hs_pct += public_signal * 0.35
        win_rate += public_signal * 0.28

        kills = 8 + ((h >> 5) % 130) / 10
        deaths = max(1.0, kills / max(0.45, kda))
        assists = 2 + ((h >> 11) % 90) / 10
        headshots = kills * (max(0.0, min(90.0, hs_pct)) / 100.0)

        kda = max(0.5, min(4.2, kda))
        hs_pct = max(5.0, min(90.0, hs_pct))
        win_rate = max(20.0, min(88.0, win_rate))

        return {
            "player_id": player.get("player_id"),
            "player_name": player.get("player_name"),
            "team_id": player.get("team_id"),
            "team_name": player.get("team_name"),
            "game_slug": context.get("game_slug"),
            "kda": round(kda, 2),
            "hs_pct": round(hs_pct, 2),
            "win_rate": round(win_rate, 2),
            "kills": round(kills, 1),
            "deaths": round(deaths, 1),
            "assists": round(assists, 1),
            "headshots": round(headshots, 1),
            "source": "riot_public_mock",
        }

    def _public_signal(self, game_slug: str) -> float:
        now = time.time()
        cached = self._public_cache.get(game_slug)
        if cached and (now - cached.get("ts", 0)) < self._cache_ttl_seconds:
            return float(cached.get("signal", 0.0))

        signal = 0.0
        try:
            if game_slug == "valorant":
                resp = requests.get(
                    "https://valorant-api.com/v1/agents?isPlayableCharacter=true",
                    timeout=8,
                )
                resp.raise_for_status()
                count = len((resp.json() or {}).get("data") or [])
                signal = max(0.0, min(20.0, float(count)))
            elif game_slug == "lol":
                resp = requests.get(
                    "https://ddragon.leagueoflegends.com/api/versions.json",
                    timeout=8,
                )
                resp.raise_for_status()
                versions = resp.json() or []
                latest = str(versions[0] if versions else "0.0")
                major = latest.split(".")[0]
                signal = max(0.0, min(20.0, float(major)))
        except Exception:
            signal = 7.0

        self._public_cache[game_slug] = {"signal": signal, "ts": now}
        return signal
