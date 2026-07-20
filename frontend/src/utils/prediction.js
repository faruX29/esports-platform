// Tahmin belirsizliği — Elo modeli iki takımı başa baş gördüğünde (güven < %5)
// yanıltıcı "%52" gibi bir sayı göstermek yerine "Belirsiz" etiketi gösteririz.
// conf = |predA - predB| (olasılıklar ~toplam 1). prediction_confidence alanı
// varsa onu, yoksa predA/predB'den türetilmişini kullanırız.

export const PREDICTION_UNCERTAIN_MARGIN = 0.05

export function predictionConfidence(predA, predB, confidence) {
  if (confidence != null && Number.isFinite(Number(confidence))) {
    return Math.abs(Number(confidence))
  }
  const a = Number(predA)
  const b = Number(predB)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const total = a + b
  if (total <= 0) return null
  return Math.abs(a - b) / total
}

// Model başa baş mı? (predA/predB null ise "belirsiz değil" — gösterecek tahmin yok)
export function isUncertainPrediction(predA, predB, confidence) {
  const conf = predictionConfidence(predA, predB, confidence)
  if (conf == null) return false
  return conf < PREDICTION_UNCERTAIN_MARGIN
}
