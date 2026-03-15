"""Liquipedia enrichment adapter for tournaments, teams, and players."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple

from database import Database
from etl.adapters.base_adapter import BaseDataAdapter
from etl.liquipedia_service import LiquipediaService


@dataclass
class MatchCandidate:
    score: float
    row: Dict[str, Any]


class LiquipediaAdapter(BaseDataAdapter):
    """Adapter that enriches PandaScore entities with Liquipedia metadata."""

    source_name = "liquipedia"

    def ensure_schema(self) -> None:
        with Database.get_connection() as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(
                    """
                    ALTER TABLE public.tournaments
                      ADD COLUMN IF NOT EXISTS extra_metadata jsonb DEFAULT '{}'::jsonb
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE public.teams
                      ADD COLUMN IF NOT EXISTS extra_metadata jsonb DEFAULT '{}'::jsonb
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE public.players
                      ADD COLUMN IF NOT EXISTS extra_metadata jsonb DEFAULT '{}'::jsonb
                    """
                )

    def run(self, limit: int = 50, sections: tuple[str, ...] = ("all",)) -> Dict[str, Dict[str, int]]:
        self.ensure_schema()

        normalized_sections = set(sections)
        if "all" in normalized_sections:
            normalized_sections = {"tournaments", "teams", "players"}

        result: Dict[str, Dict[str, int]] = {}
        if "tournaments" in normalized_sections:
            result["tournaments"] = self.enrich_tournaments(limit=limit)
        if "teams" in normalized_sections:
            result["teams"] = self.enrich_teams(limit=limit)
        if "players" in normalized_sections:
            result["players"] = self.enrich_players(limit=limit)
        return result

    def enrich_tournaments(self, limit: int = 50) -> Dict[str, int]:
        rows = self._fetch_tournaments(limit)
        updated = 0
        skipped = 0
        diagnostics: List[str] = []
        cache: Dict[Tuple[str, str], Tuple[Dict[str, Any], List[Dict[str, Any]], List[str]]] = {}

        for row in rows:
            game_slug = row.get("game_slug") or "valorant"
            tournament_name = row.get("name") or ""

            cache_key = (game_slug, tournament_name)
            try:
                if cache_key in cache:
                    metadata, bracket_rows, last_errors = cache[cache_key]
                else:
                    service = LiquipediaService(game_slug=game_slug)
                    metadata = service.get_tournament_metadata(tournament_name)
                    bracket_rows = service.get_tournament_brackets(tournament_name)
                    last_errors = list(service.last_errors)
                    cache[cache_key] = (metadata, bracket_rows, last_errors)
            except Exception as err:
                fallback_payload = {
                    "game_slug": game_slug,
                    "matched_name": tournament_name,
                    "enrichment_status": "request_failed",
                    "errors": [str(err)],
                }
                self._merge_extra_metadata(
                    table_name="tournaments",
                    row_id=row["id"],
                    source_payload=fallback_payload,
                    existing=row.get("extra_metadata"),
                )
                updated += 1
                diagnostics.append(
                    f"Tournament fallback-saved id={row.get('id')} name={tournament_name} | request failed: {err}"
                )
                continue

            if not metadata and not bracket_rows:
                reason = f"Tournament skipped id={row.get('id')} name={tournament_name} | no metadata/bracket"
                diagnostics.append(reason)
                fallback_payload = {
                    "game_slug": game_slug,
                    "matched_name": tournament_name,
                    "enrichment_status": "no_structured_data",
                    "errors": last_errors[:5],
                }
                self._merge_extra_metadata(
                    table_name="tournaments",
                    row_id=row["id"],
                    source_payload=fallback_payload,
                    existing=row.get("extra_metadata"),
                )
                updated += 1
                if last_errors:
                    diagnostics.extend([f"  -> {item}" for item in last_errors[:3]])
                continue

            payload = {
                "game_slug": row.get("game_slug"),
                "matched_name": metadata.get("Name") if metadata else tournament_name,
                "location": metadata.get("Location") or metadata.get("Country"),
                "prize_pool": metadata.get("PrizePool") or metadata.get("PrizePoolUSD"),
                "start_date": metadata.get("StartDate"),
                "end_date": metadata.get("EndDate"),
                "tier": metadata.get("Tier") or metadata.get("LiquipediaTier"),
                "brackets": bracket_rows,
            }

            self._merge_extra_metadata(
                table_name="tournaments",
                row_id=row["id"],
                source_payload=payload,
                existing=row.get("extra_metadata"),
            )
            updated += 1

        if diagnostics:
            print("⚠️ Liquipedia tournament diagnostics:")
            for line in diagnostics[:12]:
                print(f"  {line}")

        return {
            "processed": len(rows),
            "updated": updated,
            "skipped": skipped,
            "diagnostic_count": len(diagnostics),
        }

    def enrich_teams(self, limit: int = 50) -> Dict[str, int]:
        rows = self._fetch_teams(limit)
        updated = 0
        skipped = 0
        diagnostics: List[str] = []

        for row in rows:
            service = LiquipediaService(game_slug=row.get("game_slug") or "valorant")
            team_name = row.get("name") or ""
            transfer_rows = service.get_team_transfers(team_name)

            matched_transfers = self._best_match_rows(
                source_name=team_name,
                rows=transfer_rows,
                possible_name_keys=("Team", "OldTeam", "NewTeam"),
                threshold=0.70,
            )

            if not matched_transfers:
                skipped += 1
                diagnostics.append(f"Team skipped id={row.get('id')} name={team_name} | no matched transfer rows")
                if service.last_errors:
                    diagnostics.extend([f"  -> {item}" for item in service.last_errors[:2]])
                continue

            payload = {
                "game_slug": row.get("game_slug"),
                "matched_name": team_name,
                "transfers": matched_transfers,
            }

            self._merge_extra_metadata(
                table_name="teams",
                row_id=row["id"],
                source_payload=payload,
                existing=row.get("extra_metadata"),
            )
            updated += 1

        if diagnostics:
            print("⚠️ Liquipedia team diagnostics:")
            for line in diagnostics[:12]:
                print(f"  {line}")

        return {
            "processed": len(rows),
            "updated": updated,
            "skipped": skipped,
            "diagnostic_count": len(diagnostics),
        }

    def enrich_players(self, limit: int = 50) -> Dict[str, int]:
        rows = self._fetch_players(limit)
        updated = 0
        skipped = 0
        diagnostics: List[str] = []

        for row in rows:
            service = LiquipediaService(game_slug=row.get("game_slug") or "valorant")
            source_name = row.get("real_name") or row.get("nickname") or ""

            career_rows = service.get_player_career(source_name)
            matched_history = self._best_match_rows(
                source_name=source_name,
                rows=career_rows,
                possible_name_keys=("Player",),
                threshold=0.68,
            )

            if not matched_history:
                skipped += 1
                diagnostics.append(f"Player skipped id={row.get('id')} name={source_name} | no matched career rows")
                if service.last_errors:
                    diagnostics.extend([f"  -> {item}" for item in service.last_errors[:2]])
                continue

            payload = {
                "game_slug": row.get("game_slug"),
                "matched_name": source_name,
                "career_history": matched_history,
            }

            self._merge_extra_metadata(
                table_name="players",
                row_id=row["id"],
                source_payload=payload,
                existing=row.get("extra_metadata"),
            )
            updated += 1

        if diagnostics:
            print("⚠️ Liquipedia player diagnostics:")
            for line in diagnostics[:12]:
                print(f"  {line}")

        return {
            "processed": len(rows),
            "updated": updated,
            "skipped": skipped,
            "diagnostic_count": len(diagnostics),
        }

    def _fetch_tournaments(self, limit: int) -> List[Dict[str, Any]]:
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT t.id, t.name, g.slug AS game_slug, t.extra_metadata
                    FROM tournaments t
                    LEFT JOIN games g ON g.id = t.game_id
                    ORDER BY t.id DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    def _fetch_teams(self, limit: int) -> List[Dict[str, Any]]:
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT t.id,
                           t.name,
                           t.extra_metadata,
                           COALESCE(meta.game_slug, 'valorant') AS game_slug
                    FROM teams t
                    LEFT JOIN LATERAL (
                        SELECT g.slug AS game_slug
                        FROM matches m
                        JOIN games g ON g.id = m.game_id
                        WHERE m.team_a_id = t.id OR m.team_b_id = t.id
                        ORDER BY m.scheduled_at DESC NULLS LAST
                        LIMIT 1
                    ) meta ON TRUE
                    ORDER BY t.id DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    def _fetch_players(self, limit: int) -> List[Dict[str, Any]]:
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.id,
                           p.nickname,
                           p.real_name,
                           p.extra_metadata,
                           COALESCE(meta.game_slug, 'valorant') AS game_slug
                    FROM players p
                    LEFT JOIN LATERAL (
                        SELECT g.slug AS game_slug
                        FROM matches m
                        JOIN games g ON g.id = m.game_id
                        WHERE m.team_a_id = p.team_pandascore_id OR m.team_b_id = p.team_pandascore_id
                        ORDER BY m.scheduled_at DESC NULLS LAST
                        LIMIT 1
                    ) meta ON TRUE
                    ORDER BY p.id DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]

    def _merge_extra_metadata(
        self,
        *,
        table_name: str,
        row_id: Any,
        source_payload: Dict[str, Any],
        existing: Optional[Dict[str, Any]],
    ) -> None:
        base = existing or {}
        existing_source = base.get(self.source_name, {}) if isinstance(base, dict) else {}
        merged_source = {**existing_source, **source_payload}

        merged = dict(base) if isinstance(base, dict) else {}
        merged[self.source_name] = merged_source

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {table_name}
                    SET extra_metadata = %s::jsonb
                    WHERE id = %s
                    """,
                    (json.dumps(merged), row_id),
                )

    def _normalize(self, value: str) -> str:
        lowered = value.lower()
        lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
        return re.sub(r"\s+", " ", lowered).strip()

    def _score(self, left: str, right: str) -> float:
        left_norm = self._normalize(left)
        right_norm = self._normalize(right)
        if not left_norm or not right_norm:
            return 0.0

        sequence = SequenceMatcher(None, left_norm, right_norm).ratio()
        left_tokens = set(left_norm.split())
        right_tokens = set(right_norm.split())
        token_overlap = len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)
        return (sequence * 0.7) + (token_overlap * 0.3)

    def _best_match_rows(
        self,
        *,
        source_name: str,
        rows: Iterable[Dict[str, Any]],
        possible_name_keys: Tuple[str, ...],
        threshold: float,
    ) -> List[Dict[str, Any]]:
        accepted: List[MatchCandidate] = []
        for row in rows:
            best = 0.0
            for key in possible_name_keys:
                candidate_name = str(row.get(key) or "")
                best = max(best, self._score(source_name, candidate_name))
            if best >= threshold:
                accepted.append(MatchCandidate(score=best, row=row))

        accepted.sort(key=lambda item: item.score, reverse=True)
        return [item.row for item in accepted]
