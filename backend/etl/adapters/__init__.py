"""Adapter package for external enrichment data sources."""

from .base_adapter import BaseDataAdapter
from .liquipedia_adapter import LiquipediaAdapter

__all__ = ["BaseDataAdapter", "LiquipediaAdapter"]
