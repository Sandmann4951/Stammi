-- Fotos: privater Bucket, Zugriff nur für Mitglieder der Gruppe, Pfad = <group_id>/<event_id>/<media_id>-(full|thumb).jpg
-- Die App verkleinert Fotos vor dem Upload (max. 1600 px, JPEG). Größe und Dateityp begrenzt zusätzlich der Bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Lesen (signierte URLs erzeugen) nur als Mitglied der Gruppe aus dem ersten Pfadteil
create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_group_member(split_part(name, '/', 1)));

-- Hochladen nur in den Ordner der eigenen Gruppe; Überschreiben/Löschen nur über die Server-Funktion
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_group_member(split_part(name, '/', 1)));
