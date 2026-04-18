"""
Simple periodic sync worker for the ETL pipeline.

Usage examples:
  python sync_worker.py
  python sync_worker.py --once
  python sync_worker.py --interval-hours 6
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
SYNC_HISTORY_LOG = LOG_DIR / "sync_history.log"

# Keep this list intentionally small for MVP; adjust flags as needed.
SYNC_COMMANDS = [
    ["run.py", "--all-games", "--limit", "120"],
    ["run.py", "--predict", "--stats", "--fix-stale", "--stale-hours", "6"],
]
NETWORK_RETRY_ATTEMPTS = 3
NETWORK_RETRY_BASE_SECONDS = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ETL sync commands in fixed intervals")
    parser.add_argument(
        "--interval-hours",
        type=float,
        default=6.0,
        help="Hours between sync cycles (default: 6)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one cycle and exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing",
    )
    return parser.parse_args()


def configure_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    file_handler = logging.FileHandler(SYNC_HISTORY_LOG, encoding="utf-8")
    file_handler.setFormatter(formatter)

    root.addHandler(stream_handler)
    root.addHandler(file_handler)


def run_command_once(command_args: list[str], dry_run: bool = False) -> tuple[int, str, str]:
    full_cmd = [sys.executable, *command_args]
    pretty = " ".join(full_cmd)
    child_env = os.environ.copy()
    child_env["PYTHONUTF8"] = "1"
    child_env["PYTHONIOENCODING"] = "utf-8"

    if dry_run:
        logging.info("[dry-run] %s", pretty)
        return 0, "", ""

    logging.info("Running: %s", pretty)
    completed = subprocess.run(
        full_cmd,
        cwd=BASE_DIR,
        check=False,
        text=False,
        capture_output=True,
        env=child_env,
    )

    stdout_text = completed.stdout.decode("utf-8", errors="replace") if completed.stdout else ""
    stderr_text = completed.stderr.decode("utf-8", errors="replace") if completed.stderr else ""

    if stdout_text:
        for line in stdout_text.strip().splitlines():
            logging.info("[stdout] %s", line)
    if stderr_text:
        for line in stderr_text.strip().splitlines():
            logging.warning("[stderr] %s", line)

    logging.info("Finished (exit=%s): %s", completed.returncode, pretty)
    return completed.returncode, stdout_text, stderr_text


def run_command(command_args: list[str], dry_run: bool = False) -> int:
    code, _, _ = run_command_once(command_args, dry_run=dry_run)
    return code


def is_transient_network_issue(stdout_text: str, stderr_text: str) -> bool:
    blob = f"{stdout_text}\n{stderr_text}".lower()
    indicators = [
        "getaddrinfo",
        "name or service not known",
        "temporary failure in name resolution",
        "failed to resolve host",
        "dns",
        "connection aborted",
        "connection reset",
        "econnreset",
        "network is unreachable",
        "timed out",
        "timeout",
        "max retries exceeded",
    ]
    return any(token in blob for token in indicators)


def run_command_with_backoff(command_args: list[str], dry_run: bool = False) -> int:
    max_attempts = 1 if dry_run else (NETWORK_RETRY_ATTEMPTS + 1)
    for attempt in range(1, max_attempts + 1):
        code, stdout_text, stderr_text = run_command_once(command_args, dry_run=dry_run)
        if code == 0:
            return 0

        if attempt >= max_attempts or not is_transient_network_issue(stdout_text, stderr_text):
            return code

        delay = NETWORK_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
        logging.warning(
            "Transient network/DNS failure detected. Retrying command in %.1fs (%s/%s)",
            delay,
            attempt,
            max_attempts - 1,
        )
        time.sleep(delay)

    return 1


def run_dns_warmup() -> None:
    db_url = os.getenv("DATABASE_URL", "")
    hosts: list[str] = []

    if db_url:
        try:
            parsed = urlparse(db_url)
            if parsed.hostname:
                hosts.append(parsed.hostname)
        except Exception:
            pass

    # Safe fallback for this project layout if env parsing fails.
    if not hosts:
        hosts.append("aws-1-eu-north-1.pooler.supabase.com")

    for host in hosts:
        try:
            socket.getaddrinfo(host, None)
            logging.info("DNS warm-up OK for host: %s", host)
        except Exception as exc:
            logging.warning("DNS warm-up failed for host %s: %s", host, exc)


def run_sync_cycle(dry_run: bool = False) -> bool:
    cycle_ok = True
    started = datetime.now(timezone.utc)
    logging.info("=== Sync cycle started at %s ===", started.isoformat())
    run_dns_warmup()

    for index, command in enumerate(SYNC_COMMANDS, start=1):
        logging.info("Step %s/%s", index, len(SYNC_COMMANDS))
        code = run_command_with_backoff(command, dry_run=dry_run)
        if code != 0:
            cycle_ok = False
            logging.error("Command failed with exit code %s", code)

    ended = datetime.now(timezone.utc)
    duration = (ended - started).total_seconds()
    status = "ok" if cycle_ok else "failed"
    logging.info("=== Sync cycle finished at %s (%.1fs) | status=%s ===", ended.isoformat(), duration, status)
    logging.info("SYNC_HISTORY | started=%s | ended=%s | duration_seconds=%.1f | status=%s", started.isoformat(), ended.isoformat(), duration, status)
    return cycle_ok


def main() -> None:
    args = parse_args()
    configure_logging()

    interval_seconds = max(1.0, args.interval_hours * 3600)

    while True:
        run_sync_cycle(dry_run=args.dry_run)

        if args.once:
            logging.info("--once enabled, exiting.")
            return

        next_run = datetime.now(timezone.utc).timestamp() + interval_seconds
        logging.info("Next cycle in %.1f minutes.", interval_seconds / 60)

        while True:
            now = datetime.now(timezone.utc).timestamp()
            remaining = next_run - now
            if remaining <= 0:
                break
            time.sleep(min(60, remaining))


if __name__ == "__main__":
    main()
