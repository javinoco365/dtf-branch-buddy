-- RLS policies for the 'facturas' storage bucket (bucket must be created via Supabase dashboard).
-- Users may read/write objects in 'facturas/<tienda_id>/...' if they belong to that tienda.

DROP POLICY IF EXISTS "Facturas read for tienda members" ON storage.objects;
DROP POLICY IF EXISTS "Facturas insert for tienda members" ON storage.objects;
DROP POLICY IF EXISTS "Facturas update for tienda members" ON storage.objects;
DROP POLICY IF EXISTS "Facturas delete for tienda members" ON storage.objects;

CREATE POLICY "Facturas read for tienda members"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'facturas'
  AND public.is_tienda_member(auth.uid(), (storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Facturas insert for tienda members"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'facturas'
  AND public.is_tienda_member(auth.uid(), (storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Facturas update for tienda members"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'facturas'
  AND public.is_tienda_member(auth.uid(), (storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Facturas delete for tienda members"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'facturas'
  AND public.is_tienda_member(auth.uid(), (storage.foldername(name))[1]::uuid)
);