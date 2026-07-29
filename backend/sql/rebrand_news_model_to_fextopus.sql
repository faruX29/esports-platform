-- ============================================================================
-- ESKİ HABERLERDE "Model" → "Fextopus" (marka tutarlılığı)
-- ----------------------------------------------------------------------------
-- Fextopus rebrand'inden ÖNCE üretilmiş news_articles satırları hâlâ "model
-- tahminleri", "modelin favorisi", "tahmin modeli" gibi ifadeler içeriyor.
-- Backend artık "Fextopus" üretiyor (news_generator.py düzeltildi); bu SQL
-- geçmişi temizler.
--
-- Türkçe çekim/bileşik eklerine SAYGILI (canlı DB'den çıkarılan gerçek formlar,
-- salt-okunur test edildi → dönüşüm sonrası 0 "model" kalıyor):
--   tahmin/istatistik/yapay zeka modeli(-leri)  → Fextopus   (bileşik ad, önce)
--   model, Model                                → Fextopus
--   modelin, modellerin, modelinin, modellerinin→ Fextopus'un (-in hali)
--   modeli, modelleri, modelini, modellerini    → Fextopus'u  (-i hali)
--   modellemelerde (nadir)                      → Fextopus'ta
--
-- \y = kelime sınırı; 'gi' = küresel + büyük/küçük harf duyarsız.
-- Nesting sırası (içten dışa): bileşik → -in → -i → nadir → base 'model'.
--
-- ⚠️ "model" yalnızca tahmin/AI bağlamında geçiyor (DB'de doğrulandı); takım/
--    oyuncu adında "model" yok.
--
-- Supabase SQL editöründe bir kez çalıştır.
-- ============================================================================

-- Önce kaç satır etkilenecek (opsiyonel):
--   SELECT count(*) FROM news_articles
--   WHERE (title||' '||coalesce(summary,'')||' '||coalesce(content,'')) ~* '\ymodel';

BEGIN;

UPDATE news_articles SET
  title = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
            title,
            '\y(tahmin|istatistik|yapay zeka)\s+model(ler)?in(in)?\y', 'Fextopus''un', 'gi'),
            '\y(tahmin|istatistik|yapay zeka)\s+model(ler)?i\y', 'Fextopus', 'gi'),
            '\ymodel(ler)?in(in)?\y', 'Fextopus''un', 'gi'),
            '\ymodel(ler)?(in)?i\y',  'Fextopus''u',  'gi'),
            '\ymodellemelerde\y',     'Fextopus''ta', 'gi'),
            '\ymodel\y',              'Fextopus',     'gi'),
  summary = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
            coalesce(summary,''),
            '\y(tahmin|istatistik|yapay zeka)\s+model(ler)?in(in)?\y', 'Fextopus''un', 'gi'),
            '\y(tahmin|istatistik|yapay zeka)\s+model(ler)?i\y', 'Fextopus', 'gi'),
            '\ymodel(ler)?in(in)?\y', 'Fextopus''un', 'gi'),
            '\ymodel(ler)?(in)?i\y',  'Fextopus''u',  'gi'),
            '\ymodellemelerde\y',     'Fextopus''ta', 'gi'),
            '\ymodel\y',              'Fextopus',     'gi'),
  content = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
            coalesce(content,''),
            '\y(tahmin|istatistik|yapay zeka)\s+model(ler)?in(in)?\y', 'Fextopus''un', 'gi'),
            '\y(tahmin|istatistik|yapay zeka)\s+model(ler)?i\y', 'Fextopus', 'gi'),
            '\ymodel(ler)?in(in)?\y', 'Fextopus''un', 'gi'),
            '\ymodel(ler)?(in)?i\y',  'Fextopus''u',  'gi'),
            '\ymodellemelerde\y',     'Fextopus''ta', 'gi'),
            '\ymodel\y',              'Fextopus',     'gi')
WHERE (title || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'')) ~* '\ymodel';

-- Doğrulama: 0 satır kalmalı:
--   SELECT count(*) FROM news_articles
--   WHERE (title||' '||coalesce(summary,'')||' '||coalesce(content,'')) ~* '\ymodel';

COMMIT;
