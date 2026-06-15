"""Centralized logging configuration for EsportsHub Pro backend."""
import logging
import os
import sys

_LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [%(filename)s:%(lineno)d]: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging(level: str | None = None) -> None:
    """Configure the root logger. Call once at application entry point (run.py)."""
    log_level_name = (level or os.getenv("LOG_LEVEL", "INFO")).upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))

    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(handler)
    root.setLevel(log_level)
