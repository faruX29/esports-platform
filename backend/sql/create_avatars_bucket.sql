-- Profil fotoğrafları için Supabase Storage bucket + güvenlik politikaları.
-- Supabase → SQL Editor'da BİR KEZ çalıştır. (Panelden de yapılabilir: Storage →
-- New bucket → name: avatars, Public: ON. Ama policy'ler için bu SQL en temizi.)

-- 1) Public bucket (herkes okur → avatar public URL çalışır; yazma kısıtlı).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 2) Politikalar (storage.objects üzerinde). Dosya yolu: "<user_id>/<dosya>".
--    Kullanıcı yalnızca KENDİ klasörüne yazabilir; okuma herkese açık.

-- Herkese açık okuma (public bucket zaten okunur; yine de net politika)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Yükleme: giriş yapmış kullanıcı, yalnızca kendi id'siyle başlayan klasöre
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Güncelleme (upsert): yalnızca kendi klasörü
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Silme: yalnızca kendi klasörü
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
