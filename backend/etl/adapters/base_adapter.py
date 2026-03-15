"""Base adapter contracts for enrichment providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict


class BaseDataAdapter(ABC):
    """Contract for enrichment adapters to keep ETL extensible."""

    source_name: str = "unknown"

    @abstractmethod
    def ensure_schema(self) -> None:
        """Ensure required schema fields/indexes exist."""

    @abstractmethod
    def enrich_tournaments(self, limit: int = 50) -> Dict[str, int]:
        """Enrich tournaments with source-specific metadata."""

    @abstractmethod
    def enrich_teams(self, limit: int = 50) -> Dict[str, int]:
        """Enrich teams with source-specific metadata."""

    @abstractmethod
    def enrich_players(self, limit: int = 50) -> Dict[str, int]:
        """Enrich players with source-specific metadata."""

    @abstractmethod
    def run(self, limit: int = 50, sections: tuple[str, ...] = ("all",)) -> Dict[str, Dict[str, int]]:
        """Execute enrichment flow for selected sections."""
