"""Merge PandaScore match rows with optional external-source enrichments."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional


class MultiSourceDataAggregator:
    """Combine PandaScore match payloads with Riot/Steam-style adapters."""

    def __init__(self, adapters: Optional[Iterable[Any]] = None) -> None:
        self.adapters = [adapter for adapter in (adapters or []) if adapter is not None]

    def enrich_matches(self, raw_matches: List[Dict[str, Any]], game_slug: str = "") -> List[Dict[str, Any]]:
        if not raw_matches or not self.adapters:
            return raw_matches

        enriched_rows: List[Dict[str, Any]] = []
        for row in raw_matches:
            context = self._build_context(row, game_slug)
            source_enrichment: Dict[str, Any] = {}

            for adapter in self.adapters:
                source_name = getattr(adapter, "source_name", adapter.__class__.__name__.lower())
                if not self._adapter_supports_game(source_name, context.get("game_slug")):
                    continue

                try:
                    history = self._safe_fetch_history(adapter, context)
                    detail = self._safe_fetch_detail(adapter, context)

                    if history or detail:
                        source_enrichment[source_name] = {
                            "match_history": history,
                            "match_detail": detail,
                        }
                except Exception as err:
                    source_enrichment[source_name] = {
                        "error": str(err),
                        "match_history": [],
                        "match_detail": None,
                    }

            if source_enrichment:
                row = dict(row)
                raw_copy = dict(row.get("raw_data") or row)
                raw_copy["source_enrichment"] = source_enrichment
                row["raw_data"] = raw_copy

            enriched_rows.append(row)

        return enriched_rows

    def _build_context(self, row: Dict[str, Any], fallback_game_slug: str) -> Dict[str, Any]:
        videogame = (row.get("videogame") or {})
        game_slug = videogame.get("slug") or fallback_game_slug
        opponents = row.get("opponents") or []

        team_names: List[str] = []
        for opponent in opponents:
            name = ((opponent or {}).get("opponent") or {}).get("name")
            if name:
                team_names.append(str(name))

        return {
            "game_slug": game_slug,
            "match_id": row.get("id"),
            "scheduled_at": row.get("scheduled_at") or row.get("begin_at"),
            "status": row.get("status"),
            "team_names": team_names,
            "external_ids": {
                "pandascore_match_id": row.get("id"),
                "series_id": row.get("serie_id"),
            },
            "raw_match": row,
        }

    def _adapter_supports_game(self, source_name: str, game_slug: Optional[str]) -> bool:
        normalized_source = str(source_name or "").strip().lower()
        normalized_game = str(game_slug or "").strip().lower()
        if normalized_source == "riot":
            return normalized_game in {"lol", "valorant"}
        if normalized_source == "steam":
            return normalized_game in {"csgo", "cs2", "counter-strike", "counter-strike-2"}
        return True

    def _safe_fetch_history(self, adapter: Any, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        fetcher = getattr(adapter, "fetch_match_history", None)
        if not callable(fetcher):
            return []
        data = fetcher(context=context, limit=5)
        return data if isinstance(data, list) else []

    def _safe_fetch_detail(self, adapter: Any, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        fetcher = getattr(adapter, "fetch_match_detail", None)
        if not callable(fetcher):
            return None
        data = fetcher(context=context, external_match_id=None)
        return data if isinstance(data, dict) else None
