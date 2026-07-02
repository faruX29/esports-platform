"""
AI Match Prediction Module — Elo rating tabanlı.

Elo, güç-programı (strength-of-schedule) sorununu doğal olarak çözer: güçlü rakibi
yenmek zayıfı yenmekten daha çok puan kazandırır. Kazanma olasılığı lojistik
fonksiyonla üretilir → iyi kalibre. Margin-of-victory (skor farkı) K faktörünü
büyütür (dominant galibiyet daha çok rating hareketi yaratır).

Backtest (walk-forward, ~11.9k maç): genel ~%61, son 30 gün ~%61, kalibrasyon
güven arttıkça monoton (olasılık ≥%70 → ~%74-82 doğru). Eski win-rate modeli ~%56
idi ve turnuva-tier terimi her iki takıma eşit eklendiği için tahmini 50/50'ye
sönümlüyordu (sıfır ayırt edici sinyal).
"""
import logging
import math
from typing import Optional

from database import Database

logger = logging.getLogger(__name__)

ELO_BASE = 1500.0
CONFIDENT_PROB = 0.65  # "güvenli tahmin" eşiği (favori olasılığı) — trust signal


class MatchPredictor:
    """Elo rating tabanlı maç sonucu tahmini."""

    def __init__(self, k_factor: float = 32.0, base: float = ELO_BASE, use_mov: bool = True):
        self.K = k_factor
        self.base = base
        self.use_mov = use_mov
        self._ratings: Optional[dict] = None   # team_id -> Elo (lazy, in-memory)
        self._games: dict = {}                 # team_id -> oynanan maç sayısı

    # ── Elo çekirdeği ─────────────────────────────────────────────────────────
    @staticmethod
    def _expected(r_a: float, r_b: float) -> float:
        """A'nın kazanma beklentisi (lojistik)."""
        return 1.0 / (1.0 + 10 ** ((r_b - r_a) / 400.0))

    def _k(self, score_a: int, score_b: int) -> float:
        """Margin-of-victory: skor farkı büyükse K büyür (dominant galibiyet)."""
        if not self.use_mov:
            return self.K
        margin = abs((score_a or 0) - (score_b or 0))
        return self.K * (1 + math.log(margin + 1) * 0.5) if margin >= 1 else self.K

    @staticmethod
    def _fetch_finished_ordered(cur) -> list:
        cur.execute(
            """
            SELECT id, team_a_id, team_b_id, winner_id,
                   COALESCE(team_a_score, 0), COALESCE(team_b_score, 0)
            FROM matches
            WHERE status = 'finished' AND winner_id IS NOT NULL
              AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
            ORDER BY scheduled_at ASC, id ASC
            """
        )
        return cur.fetchall()

    def build_elo_ratings(self) -> dict:
        """
        Tüm bitmiş maçları kronolojik replay ederek GÜNCEL Elo ratinglerini kurar.
        Upcoming tahminleri için doğru: tüm bitmiş maçlar upcoming'den önce olduğu
        için lookahead yok. ~12k maç < 1 sn.
        """
        ratings: dict = {}
        games: dict = {}
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                for _id, a, b, w, sa, sb in self._fetch_finished_ordered(cur):
                    ra = ratings.get(a, self.base)
                    rb = ratings.get(b, self.base)
                    ea = self._expected(ra, rb)
                    s_a = 1.0 if w == a else 0.0
                    k = self._k(sa, sb)
                    ratings[a] = ra + k * (s_a - ea)
                    ratings[b] = rb + k * ((1 - s_a) - (1 - ea))
                    games[a] = games.get(a, 0) + 1
                    games[b] = games.get(b, 0) + 1
        self._ratings = ratings
        self._games = games
        logger.info(f"📊 Elo ratingleri kuruldu: {len(ratings)} takım")
        return ratings

    def _ensure_ratings(self) -> None:
        if self._ratings is None:
            self.build_elo_ratings()

    def win_probability(self, team_a_id, team_b_id) -> float:
        """A takımının kazanma olasılığı (güncel Elo ratinglerine göre)."""
        self._ensure_ratings()
        ra = self._ratings.get(team_a_id, self.base)
        rb = self._ratings.get(team_b_id, self.base)
        return self._expected(ra, rb)

    # ── Tahmin yazımı ─────────────────────────────────────────────────────────
    def predict_match(self, match_id) -> Optional[dict]:
        """Tek maç için güncel Elo'ya göre tahmin üretir ve DB'ye yazar."""
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, team_a_id, team_b_id FROM matches WHERE id = %s",
                    (match_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                _id, a, b = row
                prob_a = self.win_probability(a, b)
                prob_b = 1.0 - prob_a
                confidence = abs(prob_a - prob_b)
                cur.execute(
                    """
                    UPDATE matches
                    SET prediction_team_a = %s, prediction_team_b = %s, prediction_confidence = %s
                    WHERE id = %s
                    """,
                    (prob_a, prob_b, confidence, match_id),
                )
                conn.commit()
        return {
            'match_id': match_id, 'team_a_prob': prob_a, 'team_b_prob': prob_b,
            'confidence': confidence,
        }

    def predict_upcoming_matches(self, limit: int = 150) -> list:
        """Yaklaşan (not_started, gelecekteki) maçlara güncel Elo tahmini yazar."""
        self.build_elo_ratings()   # taze ratingler
        predictions = []
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, team_a_id, team_b_id
                    FROM matches
                    WHERE status = 'not_started' AND scheduled_at > NOW()
                      AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
                    ORDER BY scheduled_at ASC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
                for _id, a, b in rows:
                    prob_a = self.win_probability(a, b)
                    prob_b = 1.0 - prob_a
                    conf = abs(prob_a - prob_b)
                    cur.execute(
                        "UPDATE matches SET prediction_team_a=%s, prediction_team_b=%s, prediction_confidence=%s WHERE id=%s",
                        (prob_a, prob_b, conf, _id),
                    )
                    predictions.append({'match_id': _id, 'team_a_prob': prob_a, 'team_b_prob': prob_b, 'confidence': conf})
                conn.commit()
        logger.info(f"✅ {len(predictions)} yaklaşan maç tahmini güncellendi")
        return predictions

    def predict_finished_matches(self, limit: Optional[int] = None) -> list:
        """
        WALK-FORWARD backfill: her bitmiş maça, o maçtan ÖNCEki Elo ratingleriyle
        tahmin yazar → DÜRÜST out-of-sample tahmin (accuracy metriği anlamlı olur).
        Eski (kötü model) tahminlerin üzerine yazar. limit=None → tüm geçmiş.
        """
        ratings: dict = {}
        games: dict = {}
        updates = []
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                rows = self._fetch_finished_ordered(cur)
                for _id, a, b, w, sa, sb in rows:
                    ra = ratings.get(a, self.base)
                    rb = ratings.get(b, self.base)
                    ea = self._expected(ra, rb)          # maç ÖNCESİ beklenti
                    prob_a = ea
                    prob_b = 1.0 - prob_a
                    updates.append((prob_a, prob_b, abs(prob_a - prob_b), _id))
                    # gerçek sonuçla rating güncelle
                    s_a = 1.0 if w == a else 0.0
                    k = self._k(sa, sb)
                    ratings[a] = ra + k * (s_a - ea)
                    ratings[b] = rb + k * ((1 - s_a) - (1 - ea))
                    games[a] = games.get(a, 0) + 1
                    games[b] = games.get(b, 0) + 1
                if limit:
                    updates = updates[-limit:]
                cur.executemany(
                    "UPDATE matches SET prediction_team_a=%s, prediction_team_b=%s, prediction_confidence=%s WHERE id=%s",
                    updates,
                )
                conn.commit()
        self._ratings, self._games = ratings, games
        logger.info(f"✅ {len(updates)} bitmiş maça walk-forward tahmin yazıldı (out-of-sample)")
        return updates

    # ── Başarı ölçümü ─────────────────────────────────────────────────────────
    def calculate_prediction_accuracy(self, days: int = 30) -> dict:
        """
        Kaydedilmiş tahminlerin gerçek sonuçlarla karşılaştırılması.

        DÜZELTME: gerçek tahmin yapılmayan maçlar (prediction_team_a = _b, yani
        50/50 conf=0) hariç tutulur — aksi halde bunlar "yanlış" sayılıp accuracy'yi
        yapay olarak düşürür. Ayrıca "güvenli tahmin" (favori olasılığı ≥ %65)
        alt-kümesi ayrıca raporlanır (trust signal).
        """
        logger.info("\n" + "=" * 60)
        logger.info("🎯 AI TAHMİN BAŞARI ORANI")
        logger.info(f"   Dönem: {'Son ' + str(days) + ' gün' if days and days > 0 else 'Tüm zamanlar'}")
        logger.info("=" * 60)

        window = "AND scheduled_at > NOW() - (%s * INTERVAL '1 day')" if days and days > 0 else ""
        params = (days,) if days and days > 0 else ()

        query = f"""
            SELECT
                COUNT(*)                                              AS total,
                COUNT(*) FILTER (WHERE correct)                       AS correct,
                COUNT(*) FILTER (WHERE fav_prob >= {CONFIDENT_PROB})  AS conf_total,
                COUNT(*) FILTER (WHERE correct AND fav_prob >= {CONFIDENT_PROB}) AS conf_correct
            FROM (
                SELECT
                    GREATEST(prediction_team_a, prediction_team_b) AS fav_prob,
                    (
                        (prediction_team_a > prediction_team_b AND winner_id = team_a_id) OR
                        (prediction_team_b > prediction_team_a AND winner_id = team_b_id)
                    ) AS correct
                FROM matches
                WHERE status = 'finished'
                  AND winner_id IS NOT NULL
                  AND prediction_team_a IS NOT NULL
                  AND prediction_team_a <> prediction_team_b
                  {window}
            ) x
        """

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                total, correct, conf_total, conf_correct = cur.fetchone()

        total = int(total or 0)
        correct = int(correct or 0)
        conf_total = int(conf_total or 0)
        conf_correct = int(conf_correct or 0)
        accuracy_pct = (correct / total * 100) if total else 0.0
        conf_pct = (conf_correct / conf_total * 100) if conf_total else 0.0

        logger.info(f"   Değerlendirilen (gerçek tahmin) : {total}")
        logger.info(f"   Doğru                           : {correct}")
        logger.info(f"   Genel başarı                    : {accuracy_pct:.1f}%")
        logger.info(f"   Güvenli tahmin (fav ≥ %{int(CONFIDENT_PROB*100)}) : {conf_correct}/{conf_total} = {conf_pct:.1f}%")
        logger.info("=" * 60)

        if total == 0:
            logger.warning("⚠️  Değerlendirilebilir tahmin yok. Önce 'python run.py --past --predict'.")
        elif accuracy_pct >= 60:
            logger.info(f"✅ Model performansı İYİ ({accuracy_pct:.1f}%)")
        elif accuracy_pct >= 55:
            logger.info(f"🟡 Model performansı ORTA ({accuracy_pct:.1f}%)")
        else:
            logger.warning(f"⚠️  Model performansı DÜŞÜK ({accuracy_pct:.1f}%)")

        return {
            'total': total,
            'correct': correct,
            'wrong': total - correct,
            'accuracy_pct': round(accuracy_pct, 2),
            'confident_total': conf_total,
            'confident_correct': conf_correct,
            'confident_pct': round(conf_pct, 2),
        }
