"""Liquipedia MediaWiki gateway with strict request pacing."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


@dataclass(frozen=True)
class CargoCandidate:
    """Candidate query definition for resilient Cargo table probing."""

    tables: str
    fields: str
    where: Optional[str] = None
    order_by: Optional[str] = None
    limit: int = 10


class LiquipediaApiError(RuntimeError):
    """Structured API error for Liquipedia MediaWiki responses."""

    def __init__(self, code: str, info: str, params: Optional[Dict[str, Any]] = None):
        super().__init__(f"{code}: {info}")
        self.code = code
        self.info = info
        self.params = params or {}


class LiquipediaService:
    """Gateway for Liquipedia MediaWiki API.

    Design goals:
    - Strictly respect minimum 1 request/second pacing.
    - Honor User-Agent policy for identifiable clients.
    - Keep query methods modular for adapter-level orchestration.
    """

    WIKI_BY_GAME = {
        "valorant": "valorant",
        "cs2": "counterstrike",
        "csgo": "counterstrike",
        "lol": "leagueoflegends",
    }
    _pacing_lock = threading.Lock()
    _global_next_request_after = 0.0

    def __init__(self, game_slug: str = "valorant") -> None:
        self.game_slug = game_slug
        self.wiki = self.WIKI_BY_GAME.get(game_slug, "valorant")
        self.base_url = f"https://liquipedia.net/{self.wiki}/api.php"

        user_agent = os.getenv(
            "LIQUIPEDIA_USER_AGENT",
            "EsportsHubPro/1.0 (Contact: [SENIN_MAILIN])",
        )

        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": user_agent,
            "Accept": "application/json",
        })

        api_key = os.getenv("LIQUIPEDIA_API_KEY")
        if api_key:
            self.session.headers.update({"Authorization": f"Apikey {api_key}"})

        self._rate_lock = threading.Lock()
        self._last_request_monotonic = 0.0
        self.last_errors: List[str] = []
        self._pacing_file = os.getenv(
            "LIQUIPEDIA_PACING_FILE",
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".liquipedia_pacing.json")),
        )

    def _read_pacing_state(self) -> Dict[str, Any]:
        try:
            with open(self._pacing_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if isinstance(payload, dict):
                return payload
        except FileNotFoundError:
            return {}
        except Exception:
            return {}
        return {}

    def _write_pacing_state(self, state: Dict[str, Any]) -> None:
        directory = os.path.dirname(self._pacing_file)
        if directory:
            os.makedirs(directory, exist_ok=True)

        tmp_file = f"{self._pacing_file}.tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(state, f)
        os.replace(tmp_file, self._pacing_file)

    def _mark_shared_cooldown(self, wait_seconds: float, reason: str) -> float:
        wait_seconds = max(float(wait_seconds), 60.0)
        now = time.time()
        until = now + wait_seconds

        with self._pacing_lock:
            state = self._read_pacing_state()
            cooldown_until = max(float(state.get("cooldown_until", 0.0) or 0.0), until)
            state["cooldown_until"] = cooldown_until
            state["cooldown_reason"] = reason
            state["updated_at"] = now
            self._write_pacing_state(state)

        return max(0.0, cooldown_until - now)

    def _respect_rate_limit(self) -> None:
        """Ensure a hard minimum interval of 1 second between requests."""
        with self._rate_lock:
            with self._pacing_lock:
                state = self._read_pacing_state()
                now = time.time()

                cooldown_until = float(state.get("cooldown_until", 0.0) or 0.0)
                persisted_next = float(state.get("next_request_after", 0.0) or 0.0)
                local_next = self._last_request_monotonic
                global_next = self._global_next_request_after

                wait_until = max(cooldown_until, persisted_next, local_next, global_next)
                if wait_until > now:
                    time.sleep(wait_until - now)

                request_at = time.time()
                next_after = request_at + 1.0
                self._last_request_monotonic = next_after
                self._global_next_request_after = next_after

                state["next_request_after"] = next_after
                if cooldown_until <= request_at and state.get("cooldown_until"):
                    state["cooldown_until"] = 0.0
                    state["cooldown_reason"] = ""
                state["updated_at"] = request_at
                self._write_pacing_state(state)

    def _request(self, params: Dict[str, Any]) -> Dict[str, Any]:
        max_attempts = 4
        for attempt in range(1, max_attempts + 1):
            self._respect_rate_limit()
            response = self.session.get(self.base_url, params=params, timeout=30)

            if response.status_code == 429 and attempt < max_attempts:
                retry_after = response.headers.get("Retry-After")
                try:
                    wait_seconds = max(1.0, float(retry_after)) if retry_after else 60.0
                except ValueError:
                    wait_seconds = 60.0
                wait_seconds = self._mark_shared_cooldown(wait_seconds, reason="429 Too Many Requests")
                print(f"⏸️ Liquipedia cooldown active for {wait_seconds:.0f}s due to HTTP 429")
                time.sleep(wait_seconds)
                continue

            response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                err = payload["error"]
                raise LiquipediaApiError(
                    code=str(err.get("code", "unknown_error")),
                    info=str(err.get("info", "No details")),
                    params=params,
                )
            return payload

        raise RuntimeError("Liquipedia request failed after retries")

    def _record_error(self, context: str, error: Any) -> None:
        msg = f"{context}: {error}"
        self.last_errors.append(msg)

    def cargo_query(
        self,
        *,
        tables: str,
        fields: str,
        where: Optional[str] = None,
        order_by: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Run a MediaWiki cargoquery and normalize response rows."""
        params: Dict[str, Any] = {
            "action": "cargoquery",
            "format": "json",
            "tables": tables,
            "fields": fields,
            "limit": str(limit),
        }

        if where:
            params["where"] = where
        if order_by:
            params["order_by"] = order_by

        payload = self._request(params)
        rows: List[Dict[str, Any]] = []
        for row in payload.get("cargoquery", []):
            title = row.get("title", {})
            if isinstance(title, dict):
                rows.append(title)
        return rows

    def run_candidates(self, candidates: Iterable[CargoCandidate], context: str = "cargo") -> List[Dict[str, Any]]:
        """Try query candidates in order until a non-empty result is found."""
        last_error: Optional[Exception] = None
        self.last_errors = []
        for candidate in candidates:
            try:
                rows = self.cargo_query(
                    tables=candidate.tables,
                    fields=candidate.fields,
                    where=candidate.where,
                    order_by=candidate.order_by,
                    limit=candidate.limit,
                )
                if rows:
                    return rows
                self._record_error(
                    context,
                    f"No rows for tables={candidate.tables}, where={candidate.where or 'None'}"
                )
            except Exception as err:  # pragma: no cover - network/schema variability
                last_error = err
                self._record_error(
                    context,
                    f"Candidate failed tables={candidate.tables}, where={candidate.where or 'None'} -> {err}"
                )
                continue

        if last_error:
            print(f"⚠️ Liquipedia candidate queries failed for {self.game_slug}: {last_error}")
        return []

    def _query_parse_wikitext(self, page_title: str) -> str:
        payload = self._request({
            "action": "parse",
            "format": "json",
            "page": page_title,
            "prop": "wikitext",
            "formatversion": "2",
        })
        parsed = payload.get("parse", {})
        wikitext = parsed.get("wikitext")
        return wikitext if isinstance(wikitext, str) else ""

    def _query_revisions_wikitext(self, page_title: str) -> str:
        payload = self._request({
            "action": "query",
            "format": "json",
            "prop": "revisions",
            "titles": page_title,
            "rvprop": "content",
            "rvslots": "main",
            "formatversion": "2",
        })
        pages = payload.get("query", {}).get("pages", [])
        if not pages:
            return ""
        revs = pages[0].get("revisions", [])
        if not revs:
            return ""
        slots = revs[0].get("slots", {})
        main = slots.get("main", {})
        return main.get("content", "") if isinstance(main, dict) else ""

    def get_page_wikitext(self, page_candidates: List[str]) -> Tuple[str, str]:
        """Try parse first, then query revisions for each page title."""
        self.last_errors = []

        for page_title in page_candidates:
            title = str(page_title or "").strip()
            if not title:
                continue
            try:
                text = self._query_parse_wikitext(title)
                if text:
                    return title, text
                self._record_error("parse", f"Empty wikitext for page={title}")
            except Exception as err:  # pragma: no cover
                self._record_error("parse", f"page={title} -> {err}")

            try:
                text = self._query_revisions_wikitext(title)
                if text:
                    return title, text
                self._record_error("revisions", f"Empty revisions content for page={title}")
            except Exception as err:  # pragma: no cover
                self._record_error("revisions", f"page={title} -> {err}")

        return "", ""

    def search_page_titles(self, term: str, limit: int = 5) -> List[str]:
        """Search wiki page titles when exact page title is unknown."""
        try:
            payload = self._request({
                "action": "query",
                "format": "json",
                "list": "search",
                "srsearch": term,
                "srlimit": str(limit),
                "formatversion": "2",
            })
            results = payload.get("query", {}).get("search", [])
            return [str(item.get("title", "")).strip() for item in results if item.get("title")]
        except Exception as err:  # pragma: no cover
            self._record_error("search", f"term={term} -> {err}")
            return []

    def _extract_templates(self, wikitext: str) -> List[str]:
        """Extract top-level template blocks with brace balancing."""
        text = wikitext or ""
        out: List[str] = []
        i = 0
        n = len(text)
        while i < n - 1:
            if text[i:i + 2] != "{{":
                i += 1
                continue
            start = i
            depth = 1
            i += 2
            while i < n - 1 and depth > 0:
                pair = text[i:i + 2]
                if pair == "{{":
                    depth += 1
                    i += 2
                elif pair == "}}":
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth == 0:
                out.append(text[start:i])
            else:
                break
        return out

    def _parse_template_params(self, block: str) -> Dict[str, str]:
        """Parse first-level template params from a template block."""
        inner = block[2:-2].strip() if block.startswith("{{") and block.endswith("}}") else block
        if "|" not in inner:
            return {}
        parts = inner.split("|")
        params: Dict[str, str] = {}
        positional_idx = 1
        for part in parts[1:]:
            chunk = part.strip()
            if not chunk:
                continue
            if "=" in chunk:
                key, value = chunk.split("=", 1)
                params[key.strip()] = value.strip()
            else:
                params[f"_{positional_idx}"] = chunk
                positional_idx += 1
        return params

    def extract_bracket_templates(self, wikitext: str) -> List[Dict[str, Any]]:
        blocks = self._extract_templates(wikitext)
        parsed: List[Dict[str, Any]] = []

        for block in blocks:
            header_match = re.match(r"^\{\{\s*([^|}]+)", block)
            if not header_match:
                continue
            name = header_match.group(1).strip().lower().replace("template:", "")
            if "bracket" not in name and "matchlist" not in name:
                continue

            params = self._parse_template_params(block)
            parsed.append({
                "template": name,
                "param_count": len(params),
                "sample_params": dict(list(params.items())[:12]),
                "raw": block[:2000],
            })

        return parsed

    def get_tournament_metadata(self, tournament_name: str) -> Dict[str, Any]:
        safe_name = tournament_name.replace("'", "\\'")
        rows = self.run_candidates([
            CargoCandidate(
                tables="Tournaments",
                fields="Name,Tier,Location,Country,PrizePool,PrizePoolUSD,StartDate,EndDate,LiquipediaTier",
                where=f"Name='{safe_name}'",
                limit=5,
            ),
            CargoCandidate(
                tables="Tournaments",
                fields="Name,Location,Country,PrizePool,StartDate,EndDate",
                where=f"Name LIKE '%{safe_name}%'",
                limit=5,
            ),
        ], context=f"tournament_metadata:{tournament_name}")
        return rows[0] if rows else {}

    def get_tournament_brackets(self, tournament_name: str) -> List[Dict[str, Any]]:
        safe_name = tournament_name.replace("'", "\\'")
        cargo_rows = self.run_candidates([
            CargoCandidate(
                tables="Match2",
                fields="MatchId,DateTime_UTC,BestOf,Team1,Team2,Winner,Walkover",
                where=f"Tournament='{safe_name}'",
                order_by="DateTime_UTC DESC",
                limit=50,
            ),
            CargoCandidate(
                tables="Matches",
                fields="MatchId,DateTime_UTC,BestOf,Opponent1,Opponent2,Winner",
                where=f"Tournament LIKE '%{safe_name}%'",
                order_by="DateTime_UTC DESC",
                limit=50,
            ),
        ], context=f"tournament_brackets:{tournament_name}")

        if cargo_rows:
            return [{"source": "cargo", **row} for row in cargo_rows]

        # Fallback: Parse/Revisions + template extraction
        page_candidates = [
            tournament_name,
            tournament_name.replace(" ", "_"),
        ]
        page_title, wikitext = self.get_page_wikitext(page_candidates)
        if not wikitext:
            searched_titles = self.search_page_titles(tournament_name, limit=5)
            if searched_titles:
                page_title, wikitext = self.get_page_wikitext(searched_titles)

        if not wikitext:
            self._record_error("bracket_fallback", f"No wikitext fetched for tournament={tournament_name}")
            return []

        template_rows = self.extract_bracket_templates(wikitext)
        if not template_rows:
            self._record_error("bracket_fallback", f"No {{Bracket}}/{{Matchlist}} templates found for page={page_title}")
            return [{
                "source": "wikitext_raw",
                "page": page_title,
                "template": "none",
                "param_count": 0,
                "sample_params": {},
                "raw": wikitext[:2000],
            }]

        return [
            {
                "source": "wikitext_template",
                "page": page_title,
                **row,
            }
            for row in template_rows
        ]

    def get_team_transfers(self, team_name: str) -> List[Dict[str, Any]]:
        safe_name = team_name.replace("'", "\\'")
        return self.run_candidates([
            CargoCandidate(
                tables="RosterChanges",
                fields="Date,Player,Role,OldTeam,NewTeam,JoinOrLeave,Team",
                where=f"Team='{safe_name}' OR OldTeam='{safe_name}' OR NewTeam='{safe_name}'",
                order_by="Date DESC",
                limit=25,
            ),
            CargoCandidate(
                tables="RosterChanges",
                fields="Date,Player,Role,OldTeam,NewTeam,JoinOrLeave,Team",
                where=f"Team LIKE '%{safe_name}%' OR OldTeam LIKE '%{safe_name}%' OR NewTeam LIKE '%{safe_name}%'",
                order_by="Date DESC",
                limit=25,
            ),
        ], context=f"team_transfers:{team_name}")

    def get_player_career(self, player_name: str) -> List[Dict[str, Any]]:
        safe_name = player_name.replace("'", "\\'")
        return self.run_candidates([
            CargoCandidate(
                tables="PlayerHistory",
                fields="Player,Team,Role,DateStart,DateEnd,Status",
                where=f"Player='{safe_name}'",
                order_by="DateStart DESC",
                limit=30,
            ),
            CargoCandidate(
                tables="PlayerHistory",
                fields="Player,Team,Role,DateStart,DateEnd,Status",
                where=f"Player LIKE '%{safe_name}%'",
                order_by="DateStart DESC",
                limit=30,
            ),
        ], context=f"player_career:{player_name}")
