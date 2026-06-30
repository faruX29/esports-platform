"""Adapter package for external data sources and LLM providers."""

from .base_adapter import BaseDataAdapter
from .hybrid_stats_adapter import (
	BaseMatchStatsSource,
	HybridStatsBackfiller,
	LiquipediaStatsSource,
	LiquipediaWikitextSource,
	MapStat,
	MapStatsResult,
	MatchContext,
	PlayerStat,
)
from .liquipedia_adapter import LiquipediaAdapter
from .llm_adapter import BaseLLMAdapter, GeminiAdapter, LLMAdapterError
from .multi_source_aggregator import MultiSourceDataAggregator
from .riot_adapter import RiotAdapter
from .steam_adapter import SteamAdapter
from .transfer_adapter import (
	BaseTransferAdapter,
	LiquipediaTransferAdapter,
	LiquipediaWikitextTransferAdapter,
	TransferEvent,
)

__all__ = [
	"BaseDataAdapter",
	"BaseMatchStatsSource",
	"HybridStatsBackfiller",
	"LiquipediaStatsSource",
	"LiquipediaWikitextSource",
	"MapStat",
	"MapStatsResult",
	"MatchContext",
	"PlayerStat",
	"LiquipediaAdapter",
	"BaseLLMAdapter",
	"GeminiAdapter",
	"LLMAdapterError",
	"RiotAdapter",
	"SteamAdapter",
	"MultiSourceDataAggregator",
	"BaseTransferAdapter",
	"LiquipediaTransferAdapter",
	"LiquipediaWikitextTransferAdapter",
	"TransferEvent",
]
