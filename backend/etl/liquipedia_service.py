"""Liquipedia MediaWiki gateway with strict request pacing."""

from __future__ import annotations

import json
import os
import random
import re
import threading
import time
from datetime import datetime
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
        "cs-go": "counterstrike",
        "counter-strike": "counterstrike",
        "counterstrike": "counterstrike",
        "lol": "leagueoflegends",
        "league-of-legends": "leagueoflegends",
        "leagueoflegends": "leagueoflegends",
    }
    PLAYER_BOOTSTRAP: Dict[str, Dict[str, Any]] = {
        "s1mple": {
            "matched_name": "s1mple",
            "real_name": "Oleksandr Kostyliev",
            "nationality": "Ukraine",
            "social_links": {"twitter": "https://x.com/s1mpleO"},
        },
        "zywoo": {
            "matched_name": "ZywOo",
            "real_name": "Mathieu Herbaut",
            "nationality": "France",
            "social_links": {"twitter": "https://x.com/ZywOo"},
        },
        "faker": {
            "matched_name": "Faker",
            "real_name": "Lee Sang-hyeok",
            "nationality": "South Korea",
            "social_links": {"twitter": "https://x.com/Faker"},
        },
        "caps": {
            "matched_name": "Caps",
            "real_name": "Rasmus Winther",
            "nationality": "Denmark",
            "social_links": {"twitter": "https://x.com/Caps"},
        },
        "niko": {
            "matched_name": "NiKo",
            "real_name": "Nikola Kovac",
            "nationality": "Bosnia and Herzegovina",
            "social_links": {"twitter": "https://x.com/G2NiKo"},
        },
    }
    _pacing_lock = threading.Lock()
    _global_next_request_after = 0.0

    def __init__(self, game_slug: str = "valorant") -> None:
        self.game_slug = game_slug
        self.wiki = self.WIKI_BY_GAME.get(game_slug, "valorant")
        self.base_url = f"https://liquipedia.net/{self.wiki}/api.php"

        user_agent = (os.getenv(
            "LIQUIPEDIA_USER_AGENT",
            "EsportsHubPro/1.0 (Contact: ops@esportshub.local)",
        ) or "").strip()
        if not user_agent:
            user_agent = "EsportsHubPro/1.0 (Contact: ops@esportshub.local)"

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
        try:
            jitter_min = float(os.getenv("LIQUIPEDIA_JITTER_MIN_SECONDS", "1.0"))
            jitter_max = float(os.getenv("LIQUIPEDIA_JITTER_MAX_SECONDS", "2.0"))
        except ValueError:
            jitter_min, jitter_max = 1.0, 2.0

        # Keep jitter in a sane range to avoid accidental crawl stalls.
        jitter_min = max(0.6, min(jitter_min, 10.0))
        jitter_max = max(0.6, min(jitter_max, 10.0))
        self._request_jitter_min = min(jitter_min, jitter_max)
        self._request_jitter_max = max(jitter_min, jitter_max)
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
        """Ensure shared cooldown + randomized jitter pacing between requests."""
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
                jitter_seconds = random.uniform(self._request_jitter_min, self._request_jitter_max)
                next_after = request_at + jitter_seconds
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
                bounded_wait = min(wait_seconds, 5.0)
                print(
                    f"⏸️ Liquipedia cooldown scheduled ({wait_seconds:.0f}s persisted), "
                    f"retrying in {bounded_wait:.0f}s due to HTTP 429"
                )
                time.sleep(bounded_wait)
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

    def _clean_wikitext_value(self, value: str) -> str:
        text = str(value or "")
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        text = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", text)
        text = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", text)
        text = re.sub(r"\{\{[^{}]*\}\}", "", text)
        text = text.replace("''", "")
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip(" |\t\n\r")

    def _extract_infobox_player_params(self, wikitext: str) -> Dict[str, str]:
        text = wikitext or ""
        lower = text.lower()
        idx = lower.find("{{infobox")
        while idx != -1:
            block_start = idx
            depth = 0
            i = block_start
            while i < len(text) - 1:
                pair = text[i:i + 2]
                if pair == "{{":
                    depth += 1
                    i += 2
                    continue
                if pair == "}}":
                    depth -= 1
                    i += 2
                    if depth == 0:
                        break
                    continue
                i += 1

            block = text[block_start:i] if i > block_start else ""
            head = block[:120].lower()
            if "player" in head:
                params: Dict[str, str] = {}
                for line in block.splitlines():
                    stripped = line.strip()
                    if not stripped.startswith("|") or "=" not in stripped:
                        continue
                    key, val = stripped[1:].split("=", 1)
                    params[key.strip()] = val.strip()
                return params
            idx = lower.find("{{infobox", idx + 9)
        return {}

    def _extract_year_range(self, text: str) -> Tuple[Optional[str], Optional[str]]:
        raw = str(text or "")
        match = re.search(r"(19\d{2}|20\d{2})\s*[\-–]\s*(19\d{2}|20\d{2}|present|now)", raw, flags=re.I)
        if match:
            return match.group(1), match.group(2)
        single = re.search(r"(19\d{2}|20\d{2})", raw)
        if single:
            return single.group(1), None
        return None, None

    def _extract_wikilinks(self, text: str) -> List[str]:
        out: List[str] = []
        for m in re.finditer(r"\[\[([^\]]+)\]\]", text or ""):
            chunk = m.group(1)
            if ":" in chunk:
                continue
            display = chunk.split("|", 1)[-1].strip()
            clean = self._clean_wikitext_value(display)
            if clean and clean not in out:
                out.append(clean)
        return out

    def _extract_career_from_wikitext(self, player_name: str, wikitext: str) -> List[Dict[str, Any]]:
        text = wikitext or ""
        section_match = re.search(
            r"==+\s*(Career|History|Competitive\s+history)\s*==+(.+?)(?:\n==+[^=]+==+|$)",
            text,
            flags=re.I | re.S,
        )
        section = section_match.group(2) if section_match else text

        rows: List[Dict[str, Any]] = []
        seen = set()

        table_rows = re.findall(r"\|-\s*(.+?)(?=\n\|-|\n\|\}|$)", section, flags=re.S)
        for row_text in table_rows:
            year_start, year_end = self._extract_year_range(row_text)
            links = self._extract_wikilinks(row_text)
            team_name = None
            for link in links:
                lk = link.lower()
                if lk in {player_name.lower(), "present", "unknown"}:
                    continue
                if len(link) <= 2:
                    continue
                team_name = link
                break
            if not team_name:
                continue
            key = (team_name.lower(), year_start or "", year_end or "")
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "Player": player_name,
                "Team": team_name,
                "DateStart": year_start,
                "DateEnd": year_end,
                "Status": "former" if year_end and str(year_end).lower() not in {"present", "now"} else "active_or_unknown",
            })

        if rows:
            return rows

        fallback_links = self._extract_wikilinks(section)
        for link in fallback_links:
            lk = link.lower()
            if lk == player_name.lower() or len(link) <= 2:
                continue
            if lk in seen:
                continue
            seen.add(lk)
            rows.append({
                "Player": player_name,
                "Team": link,
                "DateStart": None,
                "DateEnd": None,
                "Status": "unknown",
            })
            if len(rows) >= 20:
                break
        return rows

    def get_player_career(self, player_name: str, wikitext: Optional[str] = None) -> List[Dict[str, Any]]:
        text = wikitext or ""
        if not text:
            page_candidates = [player_name, player_name.replace(" ", "_")]
            try:
                _, text = self.get_page_wikitext(page_candidates)
            except BaseException as err:
                self._record_error("player_career", f"page fetch failed player={player_name} -> {err}")
                text = ""
            if not text:
                try:
                    titles = self.search_page_titles(player_name, limit=5)
                    _, text = self.get_page_wikitext(titles)
                except BaseException as err:
                    self._record_error("player_career", f"search fetch failed player={player_name} -> {err}")
                    text = ""
        if not text:
            self._record_error("player_career", f"No wikitext fetched for player={player_name}")
            return []
        return self._extract_career_from_wikitext(player_name, text)

    def _normalize_social_url(self, value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""

        template = re.search(r"\{\{\s*(?:twitter|x|twitch|youtube|instagram|tiktok)\s*\|([^}|]+)", raw, flags=re.I)
        if template:
            raw = template.group(1).strip()

        if "[http" in raw:
            m = re.search(r"\[(https?://[^\s\]]+)", raw)
            if m:
                return m.group(1)

        raw = self._clean_wikitext_value(raw)
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw

        handle = raw.lstrip("@")
        if "twitter.com/" in raw or "x.com/" in raw:
            return f"https://{raw.lstrip('/')}"
        if "twitch.tv/" in raw:
            return f"https://{raw.lstrip('/')}"
        if "youtube.com/" in raw or "youtu.be/" in raw:
            return f"https://{raw.lstrip('/')}"
        if "instagram.com/" in raw:
            return f"https://{raw.lstrip('/')}"

        return handle

    def _extract_age(self, row: Dict[str, Any]) -> Optional[int]:
        age_val = row.get("Age") or row.get("age")
        if age_val not in (None, ""):
            try:
                age_num = int(float(str(age_val).strip()))
                if 10 <= age_num <= 80:
                    return age_num
            except Exception:
                pass

        birth = str(row.get("Birthdate") or row.get("birth_date") or row.get("birthdate") or "").strip()
        if not birth:
            return None

        age_template = re.search(r"(19\d{2}|20\d{2})\D+(\d{1,2})\D+(\d{1,2})", birth)
        if age_template:
            try:
                year = int(age_template.group(1))
                estimated = datetime.utcnow().year - year
                return estimated if 10 <= estimated <= 80 else None
            except Exception:
                pass

        match = re.search(r"(19\d{2}|20\d{2})", birth)
        if not match:
            return None
        try:
            year = int(match.group(1))
        except ValueError:
            return None

        current_year = datetime.utcnow().year
        estimated = current_year - year
        return estimated if 10 <= estimated <= 80 else None

    def _extract_social_links(self, row: Dict[str, Any]) -> Dict[str, str]:
        links: Dict[str, str] = {}
        social_key_map = {
            "twitter": ("Twitter", "twitter", "X", "XAccount", "TwitterName", "x"),
            "twitch": ("Twitch", "TwitchName"),
            "youtube": ("YouTube", "Youtube", "YT", "youtube"),
            "instagram": ("Instagram", "Insta"),
            "tiktok": ("TikTok", "Tiktok"),
            "steam": ("Steam",),
        }

        for target_key, source_keys in social_key_map.items():
            for source_key in source_keys:
                value = self._normalize_social_url(str(row.get(source_key) or ""))
                if value:
                    links[target_key] = value
                    break
        return links

    def _normalize_player_key(self, player_name: str) -> str:
        return re.sub(r"[^a-z0-9]", "", str(player_name or "").casefold())

    def _bootstrap_player_profile(self, player_name: str) -> Optional[Dict[str, Any]]:
        key = self._normalize_player_key(player_name)
        for alias, payload in self.PLAYER_BOOTSTRAP.items():
            if self._normalize_player_key(alias) == key:
                return {
                    "matched_name": payload.get("matched_name") or player_name,
                    "real_name": payload.get("real_name"),
                    "age": payload.get("age"),
                    "nationality": payload.get("nationality"),
                    "current_team": payload.get("current_team"),
                    "former_teams": payload.get("former_teams", []),
                    "career_history": payload.get("career_history", []),
                    "social_links": payload.get("social_links", {}),
                    "raw_profile": {"bootstrap": True, **payload},
                    "page": "bootstrap-fallback",
                }

        # Optional MVP mode: allow targeted runs to persist a minimal profile
        # instead of dropping players entirely when remote wikitext is unreachable.
        if os.getenv("LIQUIPEDIA_TARGETED_STUB_FALLBACK", "0") == "1" and str(player_name or "").strip():
            return {
                "matched_name": str(player_name).strip(),
                "real_name": None,
                "age": None,
                "nationality": "Unknown",
                "current_team": None,
                "former_teams": [],
                "career_history": [],
                "social_links": {},
                "raw_profile": {"bootstrap": True, "generic_stub": True},
                "page": "stub-fallback",
            }
        return None

    def get_player_profile(self, player_name: str) -> Dict[str, Any]:
        self.last_errors = []
        page_candidates = [player_name, player_name.replace(" ", "_")]
        try:
            page_title, wikitext = self.get_page_wikitext(page_candidates)
        except BaseException as err:
            self._record_error("player_profile", f"page fetch failed player={player_name} -> {err}")
            page_title, wikitext = "", ""
        if not wikitext:
            try:
                searched_titles = self.search_page_titles(player_name, limit=5)
                page_title, wikitext = self.get_page_wikitext(searched_titles)
            except BaseException as err:
                self._record_error("player_profile", f"search fetch failed player={player_name} -> {err}")
                page_title, wikitext = "", ""

        if not wikitext:
            self._record_error("player_profile", f"No wikitext fetched for player={player_name}")
            bootstrap = self._bootstrap_player_profile(player_name)
            if bootstrap:
                self._record_error("player_profile", f"Bootstrap fallback used for player={player_name}")
                return bootstrap
            return {
                "matched_name": player_name,
                "real_name": None,
                "age": None,
                "nationality": None,
                "current_team": None,
                "former_teams": [],
                "career_history": [],
                "social_links": {},
                "raw_profile": {},
                "page": "",
            }

        infobox = self._extract_infobox_player_params(wikitext)
        matched_name = self._clean_wikitext_value(
            infobox.get("id")
            or infobox.get("name")
            or page_title
            or player_name
        )

        normalized_infobox = {
            "RealName": self._clean_wikitext_value(infobox.get("name") or infobox.get("realname") or ""),
            "Birthdate": infobox.get("birth_date") or infobox.get("birthdate") or "",
            "Age": self._clean_wikitext_value(infobox.get("age") or ""),
            "Country": self._clean_wikitext_value(infobox.get("country") or infobox.get("nationality") or ""),
            "Nationality": self._clean_wikitext_value(infobox.get("nationality") or ""),
            "Team": self._clean_wikitext_value(infobox.get("team") or infobox.get("current_team") or ""),
            "Twitter": infobox.get("twitter") or infobox.get("x") or "",
            "Twitch": infobox.get("twitch") or "",
            "YouTube": infobox.get("youtube") or infobox.get("yt") or "",
            "Instagram": infobox.get("instagram") or "",
            "TikTok": infobox.get("tiktok") or "",
            "Steam": infobox.get("steam") or "",
        }

        career_rows = self.get_player_career(matched_name or player_name, wikitext=wikitext)

        former_teams: List[str] = []
        seen_teams = set()
        for row in career_rows:
            team_name = str(row.get("Team") or "").strip()
            if not team_name:
                continue
            team_key = team_name.lower()
            if team_key in seen_teams:
                continue
            seen_teams.add(team_key)
            former_teams.append(team_name)

        return {
            "matched_name": matched_name or player_name,
            "real_name": normalized_infobox.get("RealName") or None,
            "age": self._extract_age(normalized_infobox),
            "nationality": normalized_infobox.get("Country") or normalized_infobox.get("Nationality") or None,
            "current_team": normalized_infobox.get("Team") or None,
            "former_teams": former_teams,
            "career_history": career_rows,
            "social_links": self._extract_social_links(normalized_infobox),
            "raw_profile": normalized_infobox,
            "page": page_title,
        }
