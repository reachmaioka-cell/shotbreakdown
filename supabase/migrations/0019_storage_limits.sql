-- Raise the storage ceiling to the highest plan allowance and add the formats
-- real footage arrives in. Per-plan limits are enforced in the API; this is the
-- absolute bucket ceiling.
update storage.buckets
set
  file_size_limit = 2147483648,
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    'video/x-m4v', 'video/mpeg', 'video/3gpp', 'application/pdf'
  ]
where id = 'uploads';

-- The pipeline writes frames under the owner's folder using the service role,
-- which bypasses RLS. Owners still need to delete their own objects.
drop policy if exists "Users can delete own uploads" on storage.objects;
create policy "Users can delete own uploads"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own uploads" on storage.objects;
create policy "Users can update own uploads"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
