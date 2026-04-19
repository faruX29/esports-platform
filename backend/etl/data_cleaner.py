"""Data cleaning and normalization utilities for PandaScore match rows."""

import re


class DataCleaner:
    """Clean and validate match data from PandaScore API."""

    @staticmethod
    def _collapse_spaces(value):
        return re.sub(r"\s+", " ", str(value or "")).strip()

    @staticmethod
    def _normalize_tier(raw_tier):
        if not raw_tier:
            return None
        token = str(raw_tier).strip().lower().replace("_", "-")
        token = token.replace("tier", "")
        letter = re.sub(r"[^a-z]", "", token)[:1].upper()
        return letter if letter in {"S", "A", "B", "C"} else None

    @staticmethod
    def _normalize_token(token):
        return re.sub(r"[^a-z0-9]+", "", str(token or "").casefold())

    @staticmethod
    def _dedupe_repeating_chunks(compact):
        tokens = [t for t in compact.split(" ") if t]
        if len(tokens) < 2:
            return compact

        normalized_tokens = [DataCleaner._normalize_token(t) for t in tokens]
        token_count = len(tokens)

        for chunk_size in range(1, (token_count // 2) + 1):
            if token_count % chunk_size != 0:
                continue

            first_chunk = normalized_tokens[:chunk_size]
            if not any(first_chunk):
                continue

            is_repeat = True
            for i in range(chunk_size, token_count, chunk_size):
                if normalized_tokens[i:i + chunk_size] != first_chunk:
                    is_repeat = False
                    break

            if is_repeat:
                return " ".join(tokens[:chunk_size])

        return compact

    @staticmethod
    def _dedupe_double_name(name):
        """
        Remove accidental duplicate tournament/event strings.

        Examples:
        - "Masters Tokyo Masters Tokyo" -> "Masters Tokyo"
        - "Masters Tokyo | Masters Tokyo" -> "Masters Tokyo"
        """
        compact = DataCleaner._collapse_spaces(name)
        if not compact:
            return ""

        compact = DataCleaner._dedupe_repeating_chunks(compact)

        for separator in (" | ", " - ", " / "):
            if separator in compact:
                parts = [DataCleaner._collapse_spaces(p) for p in compact.split(separator) if DataCleaner._collapse_spaces(p)]
                normalized_parts = [DataCleaner._normalize_token(part) for part in parts]
                if len(parts) >= 2 and all(part == normalized_parts[0] for part in normalized_parts[1:]):
                    return parts[0]

        return compact

    @staticmethod
    def _clean_tournament_and_event_names(match):
        tournament = match.get("tournament") or {}
        league = match.get("league") or {}
        serie = match.get("serie") or {}

        tournament_name = (
            tournament.get("name")
            or match.get("tournament_name")
            or league.get("name")
            or match.get("league_name")
            or ""
        )
        event_name = (
            serie.get("full_name")
            or serie.get("name")
            or match.get("event_name")
            or ""
        )

        cleaned_tournament = DataCleaner._dedupe_double_name(tournament_name)
        cleaned_event = DataCleaner._dedupe_double_name(event_name)

        # If event is the same text as tournament, keep tournament as canonical and clear event.
        if cleaned_tournament and cleaned_event and cleaned_tournament.casefold() == cleaned_event.casefold():
            cleaned_event = ""

        return cleaned_tournament, cleaned_event

    @staticmethod
    def _to_number(value):
        try:
            parsed = float(value)
            return parsed
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _extract_player_rows_from_source_enrichment(match):
        source = (match.get("source_enrichment") or {}) if isinstance(match, dict) else {}
        riot = source.get("riot") if isinstance(source, dict) else {}
        steam = source.get("steam") if isinstance(source, dict) else {}
        pandascore = source.get("pandascore") if isinstance(source, dict) else {}

        rows = []
        for bucket in (riot, steam, pandascore):
            if not isinstance(bucket, dict):
                continue
            history = bucket.get("match_history")
            if isinstance(history, list):
                rows.extend(history)
            detail = bucket.get("match_detail")
            if isinstance(detail, dict):
                detail_rows = detail.get("player_metrics")
                if isinstance(detail_rows, list):
                    rows.extend(detail_rows)
            metrics = bucket.get("player_metrics")
            if isinstance(metrics, list):
                rows.extend(metrics)
        return rows

    @staticmethod
    def _normalize_player_stat_row(raw_row, source_label):
        if not isinstance(raw_row, dict):
            return None

        player = raw_row.get("player") if isinstance(raw_row.get("player"), dict) else {}
        player_id = (
            raw_row.get("player_id")
            or raw_row.get("id")
            or raw_row.get("pandascore_id")
            or player.get("id")
        )

        player_name = (
            raw_row.get("player_name")
            or raw_row.get("name")
            or raw_row.get("nickname")
            or player.get("name")
            or player.get("nickname")
            or ""
        )
        player_name = DataCleaner._collapse_spaces(player_name)

        if player_id is None and not player_name:
            return None

        kills = DataCleaner._to_number(raw_row.get("kills") or raw_row.get("total_kills") or raw_row.get("frags"))
        deaths = DataCleaner._to_number(raw_row.get("deaths") or raw_row.get("total_deaths"))
        assists = DataCleaner._to_number(raw_row.get("assists") or raw_row.get("total_assists"))
        headshots = DataCleaner._to_number(
            raw_row.get("headshots")
            or raw_row.get("headshot_kills")
            or raw_row.get("hs_kills")
        )

        kda = DataCleaner._to_number(raw_row.get("kda"))
        hs_pct = DataCleaner._to_number(raw_row.get("hs_pct") or raw_row.get("hs_percentage") or raw_row.get("headshot_percentage"))
        win_rate = DataCleaner._to_number(raw_row.get("win_rate") or raw_row.get("wr"))

        if kda is None and kills is not None:
            kda = (kills + (assists or 0.0)) / max(1.0, deaths or 0.0)
        if hs_pct is None and kills and headshots is not None and kills > 0:
            hs_pct = (headshots / kills) * 100

        return {
            "player_id": player_id,
            "player_name": player_name or None,
            "team_id": raw_row.get("team_id") or raw_row.get("team", {}).get("id") if isinstance(raw_row.get("team"), dict) else raw_row.get("team_id"),
            "kills": kills,
            "deaths": deaths,
            "assists": assists,
            "headshots": headshots,
            "kda": kda,
            "hs_pct": hs_pct,
            "win_rate": win_rate,
            "source": source_label,
        }

    @staticmethod
    def _extract_players_from_games(match):
        rows = []
        games = match.get("games") or []
        for game in games:
            if not isinstance(game, dict):
                continue

            for key in ("players", "player_stats", "participants"):
                value = game.get(key)
                if isinstance(value, list):
                    rows.extend(value)

            statistics = game.get("statistics")
            if isinstance(statistics, dict):
                for key in ("players", "player_stats", "participants"):
                    value = statistics.get(key)
                    if isinstance(value, list):
                        rows.extend(value)

                teams = statistics.get("teams")
                if isinstance(teams, list):
                    for team in teams:
                        if isinstance(team, dict):
                            team_players = team.get("players")
                            if isinstance(team_players, list):
                                rows.extend(team_players)
        return rows

    @staticmethod
    def _merge_player_summaries(rows):
        bucket = {}
        for row in rows:
            if not row:
                continue
            key = row.get("player_id") if row.get("player_id") is not None else (row.get("player_name") or "").casefold()
            if not key:
                continue

            current = bucket.get(key)
            if not current:
                bucket[key] = {
                    "player_id": row.get("player_id"),
                    "player_name": row.get("player_name"),
                    "team_id": row.get("team_id"),
                    "kills": 0.0,
                    "deaths": 0.0,
                    "assists": 0.0,
                    "headshots": 0.0,
                    "win_rate_samples": [],
                    "sources": set(),
                    "samples": 0,
                }
                current = bucket[key]

            for metric in ("kills", "deaths", "assists", "headshots"):
                value = DataCleaner._to_number(row.get(metric))
                if value is not None:
                    current[metric] += value

            wr = DataCleaner._to_number(row.get("win_rate"))
            if wr is not None:
                current["win_rate_samples"].append(max(0.0, min(100.0, wr)))

            current["samples"] += 1
            if row.get("source"):
                current["sources"].add(str(row.get("source")))

        merged = []
        for item in bucket.values():
            kills = item["kills"]
            deaths = item["deaths"]
            assists = item["assists"]
            headshots = item["headshots"]
            kda = (kills + assists) / max(1.0, deaths)
            hs_pct = (headshots / kills) * 100 if kills > 0 else None
            win_samples = item["win_rate_samples"]
            win_rate = (sum(win_samples) / len(win_samples)) if win_samples else None

            merged.append({
                "player_id": item["player_id"],
                "player_name": item["player_name"],
                "team_id": item["team_id"],
                "kills": round(kills, 2),
                "deaths": round(deaths, 2),
                "assists": round(assists, 2),
                "headshots": round(headshots, 2),
                "kda": round(kda, 2),
                "hs_pct": round(max(0.0, min(100.0, hs_pct)), 2) if hs_pct is not None else None,
                "win_rate": round(max(0.0, min(100.0, win_rate)), 2) if win_rate is not None else None,
                "samples": item["samples"],
                "source": ",".join(sorted(item["sources"])) if item["sources"] else "pandascore",
            })

        merged.sort(key=lambda row: (row.get("kills") or 0.0), reverse=True)
        return merged[:30]

    @staticmethod
    def _build_player_summaries(match):
        rows = []

        for raw_row in DataCleaner._extract_player_rows_from_source_enrichment(match):
            normalized = DataCleaner._normalize_player_stat_row(raw_row, "source_enrichment")
            if normalized:
                rows.append(normalized)

        for raw_row in DataCleaner._extract_players_from_games(match):
            normalized = DataCleaner._normalize_player_stat_row(raw_row, "pandascore_match")
            if normalized:
                rows.append(normalized)

        return DataCleaner._merge_player_summaries(rows)

    @staticmethod
    def clean_match_data(match):
        """Clean and validate a single match row from PandaScore."""
        if not match.get("id"):
            return None

        opponents = match.get("opponents") or []
        if len(opponents) < 2:
            return None

        if not match.get("scheduled_at") and not match.get("begin_at"):
            return None

        team_a = (opponents[0] or {}).get("opponent") or {}
        team_b = (opponents[1] or {}).get("opponent") or {}
        if not team_a.get("id") or not team_b.get("id"):
            return None

        team_a_score = None
        team_b_score = None
        results = match.get("results") or []
        if len(results) >= 2:
            team_a_score = results[0].get("score")
            team_b_score = results[1].get("score")

        tournament = match.get("tournament") or {}
        league = match.get("league") or {}
        serie = match.get("serie") or {}

        tournament_name, event_name = DataCleaner._clean_tournament_and_event_names(match)
        tournament_tier = DataCleaner._normalize_tier(tournament.get("tier") or league.get("tier"))

        tournament_begin_at = (
            tournament.get("begin_at")
            or serie.get("begin_at")
            or league.get("begin_at")
        )
        tournament_end_at = (
            tournament.get("end_at")
            or serie.get("end_at")
            or league.get("end_at")
        )

        player_summaries = DataCleaner._build_player_summaries(match)

        raw_payload = dict(match)
        source_enrichment = raw_payload.get("source_enrichment")
        if not isinstance(source_enrichment, dict):
            source_enrichment = {}
        if player_summaries:
            raw_payload["pandascore_player_summaries"] = player_summaries
            source_enrichment.setdefault("pandascore", {})
            if isinstance(source_enrichment.get("pandascore"), dict):
                source_enrichment["pandascore"]["player_metrics"] = player_summaries
            raw_payload["source_enrichment"] = source_enrichment

        cleaned = {
            "id": match["id"],
            "scheduled_at": match.get("scheduled_at") or match.get("begin_at"),
            "status": match.get("status", "not_started"),
            "game_slug": (match.get("videogame") or {}).get("slug"),
            "team_a_id": team_a["id"],
            "team_a_name": team_a.get("name", "Unknown"),
            "team_a_acronym": team_a.get("acronym"),
            "team_a_logo": team_a.get("image_url"),
            "team_a_score": team_a_score,
            "team_b_id": team_b["id"],
            "team_b_name": team_b.get("name", "Unknown"),
            "team_b_acronym": team_b.get("acronym"),
            "team_b_logo": team_b.get("image_url"),
            "team_b_score": team_b_score,
            "tournament_id": match.get("tournament_id") or tournament.get("id") or league.get("id"),
            "tournament_name": tournament_name,
            "event_name": event_name or None,
            "tournament_begin_at": tournament_begin_at,
            "tournament_end_at": tournament_end_at,
            "tournament_tier": tournament_tier,
            "tournament_region": league.get("region") or tournament.get("region"),
            "serie_id": match.get("serie_id") or serie.get("id"),
            "winner_id": match.get("winner_id"),
            "player_summaries": player_summaries,
            "raw_data": raw_payload,
        }

        return cleaned

    @staticmethod
    def clean_matches(matches):
        """Clean and validate multiple matches."""
        cleaned_matches = []
        skipped_count = 0

        for match in matches:
            cleaned = DataCleaner.clean_match_data(match)
            if cleaned:
                cleaned_matches.append(cleaned)
            else:
                skipped_count += 1

        if skipped_count > 0:
            print(f"⚠️  Skipped {skipped_count} invalid matches (missing teams or schedule)")

        print(f"✅ Cleaned {len(cleaned_matches)} valid matches")
        return cleaned_matches