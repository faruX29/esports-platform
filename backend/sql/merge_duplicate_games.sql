-- ============================================================================
-- MÜKERRER OYUN KAYITLARINI BİRLEŞTİR (CS2 ve LoL)
-- ----------------------------------------------------------------------------
-- Sorun: PandaScore videogame.slug kanonik olmayan varyant döndürüyordu
-- ('cs-go', 'league-of-legends'). ETL bunları normalize etmeden games'e yazınca
-- her varyant AYRI bir satır oldu:
--
--   id=2  Counter-Strike 2   slug 'csgo'               (temiz isim, 204 takım)
--   id=8  Cs-Go              slug 'cs-go'              (maçların çoğu burada)
--   id=3  League of Legends  slug 'lol'                (temiz isim, 164 takım)
--   id=9  League-Of-Legends  slug 'league-of-legends'  (maçların çoğu burada)
--
-- Çözüm: temiz isimli 2/3'ü KANONİK tut, 8→2 ve 9→3 taşı, 8/9'u sil.
-- (Valorant id=1'de tekil, dokunulmuyor. follows oyunu slug string tutuyor,
--  id kullanmaz → etkilenmez.)
--
-- ⚠️ ÖNKOŞUL: sync_matches.py'deki GAME_SLUG_ALIASES düzeltmesi CANLI olmalı;
--    yoksa bir sonraki ETL çalışması 8/9'u yeniden yaratır.
--
-- games'e bağlı FK'ler yalnızca: teams, tournaments, matches (üçü de repoint
-- ediliyor). Tek transaction — herhangi bir adım patlarsa hepsi geri alınır.
--
-- Supabase SQL editöründe bir kez çalıştır.
-- ============================================================================

BEGIN;

-- --- Birleştirme öncesi durum (log için) --------------------------------
--   SELECT game_id, count(*) FROM matches     GROUP BY game_id ORDER BY game_id;
--   SELECT game_id, count(*) FROM tournaments GROUP BY game_id ORDER BY game_id;

-- CS2: 8 → 2 -------------------------------------------------------------
UPDATE matches      SET game_id = 2 WHERE game_id = 8;
UPDATE tournaments  SET game_id = 2 WHERE game_id = 8;
UPDATE teams        SET game_id = 2 WHERE game_id = 8;  -- şu an 0 satır; güvenlik

-- LoL: 9 → 3 -------------------------------------------------------------
UPDATE matches      SET game_id = 3 WHERE game_id = 9;
UPDATE tournaments  SET game_id = 3 WHERE game_id = 9;
UPDATE teams        SET game_id = 3 WHERE game_id = 9;  -- şu an 0 satır; güvenlik

-- Artık kimse 8/9'a bağlı değil → mükerrer satırları sil -----------------
DELETE FROM games WHERE id IN (8, 9);

-- --- Doğrulama: 8/9 kalmamalı, games 3 satır olmalı ---------------------
--   SELECT id, name, slug FROM games ORDER BY id;   -- beklenen: 1,2,3
--   SELECT game_id, count(*) FROM matches GROUP BY game_id ORDER BY game_id;

COMMIT;

-- Birleştirme sonrası beklenen games tablosu:
--   1  Valorant           valorant
--   2  Counter-Strike 2   csgo
--   3  League of Legends  lol
