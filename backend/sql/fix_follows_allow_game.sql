-- ============================================================================
-- FIX: follows.target_type 'game' desteği
-- ----------------------------------------------------------------------------
-- Sorun: follows tablosunun CHECK kısıtı yalnızca ('team','player') kabul
-- ediyordu. Ama UserContext bir takım takip edildiğinde o takımın oyununu da
-- otomatik olarak target_type='game' satırı olarak yazıyor. Bu satır kısıtı
-- ihlal ettiği için INSERT komple reddoluyor; öncesinde eski kayıtlar zaten
-- silindiği için follows tablosu boş kalıyordu → kullanıcı F5 attığında tüm
-- takipler kayboluyordu.
--
-- Çözüm: kısıta 'game' değerini ekle. (Frontend yazma mantığı da artık
-- fark-tabanlı: önce ekler, sonra fazlayı siler; kısmi hata veri kaybı yapmaz.)
--
-- Supabase SQL editöründe bir kez çalıştır.
-- ============================================================================

alter table public.follows drop constraint if exists follows_target_type_check;

alter table public.follows
  add constraint follows_target_type_check
  check (target_type in ('team', 'player', 'game'));
