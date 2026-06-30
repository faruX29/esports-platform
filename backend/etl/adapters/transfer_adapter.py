"""Transfer & Roster Change adapter layer.

Pipeline per ingest() call:
  1. fetch_raw_transfers() → LRU-cached Liquipedia Cargo query.
  2. _parse_row()          → raw dict → TransferEvent dataclass + idempotency hash.
  3. _resolve_ids()        → player_name / team_name → local DB IDs.
  4. _persist()            → INSERT ON CONFLICT DO NOTHING (idempotent).

The thin DB trigger (trg_roster_change_sync) handles players.team_id update
for permanent/trial transfers — no application code needed for that step.
"""

from __future__ import annotations

import hashlib
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Optional

from database import Database
from etl.liquipedia_service import CargoCandidate, LiquipediaService

logger = logging.getLogger(__name__)


# ── Liquipedia JoinOrLeave → internal transfer_type ──────────────────────────
_JOIN_OR_LEAVE_MAP: dict[str, str] = {
    "joins":  "permanent",
    "leaves": "release",
    "loan":   "loan",
    "trial":  "trial",
}


# ── TransferEvent dataclass ───────────────────────────────────────────────────

@dataclass
class TransferEvent:
    """
    Single roster change event parsed from a data source.

    Phase 1 (after parse): player_name / *_team_name populated, IDs are None.
    Phase 2 (after _resolve_ids): *_id fields filled in where DB match found.
    idempotency_hash is computed in __post_init__ from name + target + date.
    """

    player_name:   str
    old_team_name: Optional[str]
    new_team_name: Optional[str]
    transfer_date: date
    transfer_type: str          # 'permanent' | 'loan' | 'trial' | 'release'
    game_slug:     str
    data_source:   str
    raw_payload:   dict

    # Resolved by _resolve_ids() — None means not found in local DB
    player_id:      Optional[int] = field(default=None, compare=False)
    source_team_id: Optional[int] = field(default=None, compare=False)
    target_team_id: Optional[int] = field(default=None, compare=False)
    idempotency_hash: str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.idempotency_hash:
            self.idempotency_hash = self._compute_hash()

    def _compute_hash(self) -> str:
        key = "|".join([
            self.player_name.strip().lower(),
            (self.new_team_name or "").strip().lower(),
            self.transfer_date.isoformat(),
        ])
        return hashlib.sha256(key.encode()).hexdigest()


# ── Module-level LRU cache (same pattern as liquipedia_adapter.py) ────────────
# Keyed by (game_slug, since_date_iso) — one entry per game per day-window.
# maxsize=128 caps RAM; JSON string because lists/dicts aren't hashable.

@lru_cache(maxsize=128)
def _lru_recent_transfers(game_slug: str, since_date: str) -> str:
    """Fetch and cache Liquipedia RosterChanges rows for a (game, date) window."""
    svc = LiquipediaService(game_slug=game_slug)
    rows = svc.run_candidates(
        [
            CargoCandidate(
                tables="RosterChanges",
                fields="Date,Player,Role,OldTeam,NewTeam,JoinOrLeave,Team",
                where=f"Date >= '{since_date}'",
                order_by="Date DESC",
                limit=100,
            ),
        ],
        context=f"recent_transfers:{game_slug}:{since_date}",
    )
    return json.dumps(rows)


# ── Abstract base ─────────────────────────────────────────────────────────────

class BaseTransferAdapter(ABC):
    """Contract for all transfer ingestion adapters."""

    game_slug:   str = "valorant"
    data_source: str = "unknown"

    @abstractmethod
    def fetch_raw_transfers(self, days_back: int = 7) -> list[TransferEvent]:
        """
        Pull recent transfer events from the data source.

        Implementations must:
        - Return TransferEvent objects with idempotency_hash already set.
        - Never raise — log and return partial results on partial failures.
        """

    # ── Public entry point ────────────────────────────────────────────────────

    def ingest(self, days_back: int = 7) -> dict[str, int]:
        """
        Full pipeline: fetch → resolve → persist.

        Returns stats dict: {found, inserted, skipped, failed}.
        'skipped' covers duplicates (ON CONFLICT) + unresolvable names.
        """
        stats: dict[str, int] = {"found": 0, "inserted": 0, "skipped": 0, "failed": 0}

        events = self.fetch_raw_transfers(days_back=days_back)
        stats["found"] = len(events)
        logger.info(
            "🔄 %d transfer olayı bulundu  game=%s  son %d gün",
            len(events), self.game_slug, days_back,
        )

        for event in events:
            self._resolve_ids(event)

            if event.player_id is None:
                logger.debug("⚠️  Oyuncu DB'de bulunamadı: %s — atlanıyor", event.player_name)
                stats["skipped"] += 1
                continue

            try:
                inserted = self._persist(event)
                if inserted:
                    stats["inserted"] += 1
                    logger.info(
                        "✅ Transfer  %s → %s  (%s)",
                        event.old_team_name or "FA",
                        event.new_team_name or "FA",
                        event.player_name,
                    )
                else:
                    stats["skipped"] += 1  # ON CONFLICT — already in DB
            except Exception as exc:
                logger.warning(
                    "❌ DB kayıt hatası  hash=%s  %s",
                    event.idempotency_hash[:12], exc,
                )
                stats["failed"] += 1

        return stats

    # ── Shared DB helpers (available to all subclasses) ───────────────────────

    def _resolve_ids(self, event: TransferEvent) -> None:
        """
        Populate player_id, source_team_id, target_team_id from the local DB.

        Lookup order:
          player  → exact LOWER match on nickname or name.
          teams   → ILIKE match (tolerates minor capitalisation differences).

        Mutates event in-place; sets field to None if no DB row found.
        """
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # Player: exact lowercase match on nickname or full name
                cur.execute(
                    """
                    SELECT id FROM players
                     WHERE LOWER(nickname)  = LOWER(%s)
                        OR LOWER(real_name) = LOWER(%s)
                     LIMIT 1
                    """,
                    (event.player_name, event.player_name),
                )
                row = cur.fetchone()
                event.player_id = row[0] if row else None

                if event.player_id is None:
                    return  # team lookups pointless without a resolved player

                if event.old_team_name:
                    cur.execute(
                        "SELECT id FROM teams WHERE name ILIKE %s LIMIT 1",
                        (event.old_team_name,),
                    )
                    row = cur.fetchone()
                    event.source_team_id = row[0] if row else None

                if event.new_team_name:
                    cur.execute(
                        "SELECT id FROM teams WHERE name ILIKE %s LIMIT 1",
                        (event.new_team_name,),
                    )
                    row = cur.fetchone()
                    event.target_team_id = row[0] if row else None

    def _persist(self, event: TransferEvent) -> bool:
        """
        Insert one TransferEvent into roster_changes.

        ON CONFLICT (idempotency_hash) DO NOTHING ensures re-runs are safe.
        Returns True if a new row was created, False on duplicate.
        """
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.roster_changes (
                        player_id, source_team_id, target_team_id,
                        transfer_date, transfer_type, data_source,
                        raw_payload, idempotency_hash
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (idempotency_hash) DO NOTHING
                    """,
                    (
                        event.player_id,
                        event.source_team_id,
                        event.target_team_id,
                        event.transfer_date.isoformat(),
                        event.transfer_type,
                        event.data_source,
                        json.dumps(event.raw_payload),
                        event.idempotency_hash,
                    ),
                )
                inserted = cur.rowcount > 0
            conn.commit()
        return inserted


# ── Liquipedia implementation ─────────────────────────────────────────────────

class LiquipediaTransferAdapter(BaseTransferAdapter):
    """
    Ingests roster changes from the Liquipedia Cargo 'RosterChanges' table.

    Rate limiting is handled by LiquipediaService (global ≥1 req/s pacing).
    The module-level LRU cache prevents redundant API calls within a process.
    Games outside SUPPORTED_GAMES are rejected at construction time.
    """

    data_source = "liquipedia"
    SUPPORTED_GAMES = ("valorant", "cs2", "lol")

    def __init__(self, game_slug: str = "valorant") -> None:
        if game_slug not in self.SUPPORTED_GAMES:
            raise ValueError(
                f"Desteklenmeyen oyun: {game_slug!r}. "
                f"Geçerli seçenekler: {self.SUPPORTED_GAMES}"
            )
        self.game_slug = game_slug

    # ── Public API ────────────────────────────────────────────────────────────

    def fetch_raw_transfers(self, days_back: int = 7) -> list[TransferEvent]:
        """
        Fetch + deduplicate transfer events for the configured game.

        Uses _lru_recent_transfers for the API call; in-process dedup via
        seen_hashes set handles duplicate rows from Liquipedia Cargo.
        """
        since = (datetime.now(timezone.utc) - timedelta(days=days_back)).date()
        since_str = since.isoformat()
        logger.debug("Liquipedia transfer fetch  game=%s  since=%s", self.game_slug, since_str)

        raw_json = _lru_recent_transfers(self.game_slug, since_str)
        rows: list[dict] = json.loads(raw_json)

        events: list[TransferEvent] = []
        seen: set[str] = set()

        for row in rows:
            event = self._parse_row(row)
            if event is None:
                continue
            if event.idempotency_hash in seen:
                continue
            seen.add(event.idempotency_hash)
            events.append(event)

        logger.debug("%d unique event(s) parsed from %d raw rows", len(events), len(rows))
        return events

    # ── Private parser ────────────────────────────────────────────────────────

    def _parse_row(self, row: dict) -> Optional[TransferEvent]:
        """
        Convert a raw Liquipedia Cargo dict → TransferEvent.

        Returns None (and logs debug) for rows with missing required fields.
        Fields: Date, Player, OldTeam, NewTeam, JoinOrLeave (Role is optional).
        """
        player_name = (row.get("Player") or "").strip()
        if not player_name:
            return None

        raw_date = (row.get("Date") or "").strip()
        try:
            transfer_date = date.fromisoformat(raw_date)
        except ValueError:
            logger.debug("Tarih ayrıştırılamadı: %r — satır atlandı", raw_date)
            return None

        join_or_leave = (row.get("JoinOrLeave") or "").strip().lower()
        transfer_type = _JOIN_OR_LEAVE_MAP.get(join_or_leave, "permanent")

        old_team = (row.get("OldTeam") or "").strip() or None
        new_team = (row.get("NewTeam") or "").strip() or None

        return TransferEvent(
            player_name=player_name,
            old_team_name=old_team,
            new_team_name=new_team,
            transfer_date=transfer_date,
            transfer_type=transfer_type,
            game_slug=self.game_slug,
            data_source=self.data_source,
            raw_payload={
                "Date":        raw_date,
                "Player":      player_name,
                "Role":        row.get("Role"),
                "OldTeam":     old_team,
                "NewTeam":     new_team,
                "JoinOrLeave": row.get("JoinOrLeave"),
            },
        )


class LiquipediaWikitextTransferAdapter(BaseTransferAdapter):
    """
    Cargo API KEY GEREKTİRMEYEN transfer kaynağı — aylık 'Player Transfers/<yıl>/<ay>'
    wikitext sayfalarından roster değişikliklerini çeker (action=parse).

    Cargo key onayı beklenirken birincil hat; key gelince Cargo'lu adapter öne
    alınabilir, bu yedek kalır (Chain of Responsibility — [[strategic-decisions]]).
    """

    data_source = "liquipedia_wikitext"
    SUPPORTED_GAMES = ("valorant", "cs2", "lol")
    _MONTHS = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]

    def __init__(self, game_slug: str = "valorant") -> None:
        if game_slug not in self.SUPPORTED_GAMES:
            raise ValueError(
                f"Desteklenmeyen oyun: {game_slug!r}. Geçerli: {self.SUPPORTED_GAMES}"
            )
        self.game_slug = game_slug

    def fetch_raw_transfers(self, days_back: int = 7) -> list[TransferEvent]:
        svc = LiquipediaService(game_slug=self.game_slug)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).date()

        events: list[TransferEvent] = []
        seen: set[str] = set()
        for (yr, mo) in self._months_in_window(cutoff):
            try:
                rows = svc.get_transfers_wikitext(yr, self._MONTHS[mo - 1])
            except Exception as exc:
                logger.warning("⚠️  Transfer wikitext alınamadı %s/%s: %s", yr, mo, exc)
                continue
            for row in rows:
                event = self._row_to_event(row)
                if event is None or event.transfer_date < cutoff:
                    continue
                if event.idempotency_hash in seen:
                    continue
                seen.add(event.idempotency_hash)
                events.append(event)

        logger.info("📥 Wikitext transfer: %d olay (son %d gün)", len(events), days_back)
        return events

    def _months_in_window(self, cutoff: date) -> list[tuple[int, int]]:
        """cutoff ayından bugünün ayına kadar (yıl, ay) listesi."""
        today = datetime.now(timezone.utc).date()
        out: list[tuple[int, int]] = []
        y, m = cutoff.year, cutoff.month
        while (y, m) <= (today.year, today.month):
            out.append((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1
        return out

    def _row_to_event(self, row: dict) -> Optional[TransferEvent]:
        name = (row.get("player") or "").strip()
        if not name:
            return None
        try:
            transfer_date = date.fromisoformat((row.get("date") or "").strip())
        except ValueError:
            return None

        old_team = row.get("old_team")
        new_team = row.get("new_team")
        # Tür: yeni takım var/eski yok → katılım; eski var/yeni yok → ayrılık
        transfer_type = "release" if (old_team and not new_team) else "permanent"

        return TransferEvent(
            player_name=name,
            old_team_name=old_team,
            new_team_name=new_team,
            transfer_date=transfer_date,
            transfer_type=transfer_type,
            game_slug=self.game_slug,
            data_source=self.data_source,
            raw_payload={"source": "wikitext", **row},
        )
