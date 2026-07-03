// Özellik bayrakları (feature flags).
//
// DISCORD_ENABLED: Discord OAuth butonlarını göster/gizle. Kod hazır; buton
// yalnızca Supabase'de Discord provider açıldıktan SONRA true yapılmalı — aksi
// halde tıklanınca "provider not enabled" hatası verir. [[auth-onboarding]] B adımı.
export const DISCORD_ENABLED = false
