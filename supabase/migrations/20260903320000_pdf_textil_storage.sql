-- ============================================================================
-- PDF DEL MÓDULO TEXTIL · Sitio en Storage, y un fallo de paso
-- ============================================================================
--
-- QUÉ FALTA
--   Las facturas textil congelan el logo de la marca en emisor_snapshot desde
--   la fase 2, pero no hay PDF donde pintarlo: no se pueden mandar al cliente.
--   Se guardan en el mismo bucket 'facturas' que las de DTF, bajo el prefijo
--   'textil/' porque no cuelgan de ninguna tienda.
--
-- EL FALLO QUE APARECIÓ AL IR A HACERLO
--   Las cuatro políticas del bucket 'facturas' hacen:
--
--     (storage.foldername(name))[1]::uuid
--
--   Con una ruta 'textil/xxx.pdf', ese cast NO devuelve falso: LANZA UN ERROR
--   («invalid input syntax for type uuid»). Y como la política se evalúa fila a
--   fila, basta con que exista un objeto en 'textil/' para que cualquier
--   listado del bucket reviente para todo el mundo, también para las facturas
--   de DTF que sí están bien.
--
--   Es decir: el prefijo nuevo no solo no funcionaría, sino que rompería lo que
--   ya funciona. Se arregla antes de crear el primero.
--
-- REVERSIBLE
--   Sí. Una función y ocho políticas reescritas. No toca ningún objeto.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Un cast que no revienta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carpeta_uuid(_ruta TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN (storage.foldername(_ruta))[1]::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.carpeta_uuid(TEXT) IS
  'La primera carpeta de una ruta de Storage como UUID, o NULL si no lo es. '
  'Existe porque un cast directo lanza excepción y en una política eso rompe '
  'la consulta entera, no solo esa fila.';

GRANT EXECUTE ON FUNCTION public.carpeta_uuid(TEXT) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Las de tienda, ahora sin reventar ante una carpeta que no es un UUID
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Facturas read for tienda members" ON storage.objects;
CREATE POLICY "Facturas read for tienda members"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'facturas'
  AND public.carpeta_uuid(name) IS NOT NULL
  AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
);

DROP POLICY IF EXISTS "Facturas insert for tienda members" ON storage.objects;
CREATE POLICY "Facturas insert for tienda members"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'facturas'
  AND public.carpeta_uuid(name) IS NOT NULL
  AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
);

DROP POLICY IF EXISTS "Facturas update for tienda members" ON storage.objects;
CREATE POLICY "Facturas update for tienda members"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'facturas'
  AND public.carpeta_uuid(name) IS NOT NULL
  AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
);

DROP POLICY IF EXISTS "Facturas delete for tienda members" ON storage.objects;
CREATE POLICY "Facturas delete for tienda members"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'facturas'
  AND public.carpeta_uuid(name) IS NOT NULL
  AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
);

-- El bucket arrastra DOS juegos de políticas equivalentes con nombres
-- distintos: las de arriba y estas, de una migración posterior de Lovable.
-- Las dos llevan el cast que revienta, así que las dos hay que arreglarlas.
-- Que sobra un juego queda anotado; quitarlo es otra tarea.
DROP POLICY IF EXISTS "facturas_select_miembros" ON storage.objects;
CREATE POLICY "facturas_select_miembros"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'facturas'
    AND public.carpeta_uuid(name) IS NOT NULL
    AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
  );

DROP POLICY IF EXISTS "facturas_insert_miembros" ON storage.objects;
CREATE POLICY "facturas_insert_miembros"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'facturas'
    AND public.carpeta_uuid(name) IS NOT NULL
    AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
  );

DROP POLICY IF EXISTS "facturas_update_miembros" ON storage.objects;
CREATE POLICY "facturas_update_miembros"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'facturas'
    AND public.carpeta_uuid(name) IS NOT NULL
    AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
  );

DROP POLICY IF EXISTS "facturas_delete_miembros" ON storage.objects;
CREATE POLICY "facturas_delete_miembros"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'facturas'
    AND public.carpeta_uuid(name) IS NOT NULL
    AND public.is_tienda_member(auth.uid(), public.carpeta_uuid(name))
  );

-- ---------------------------------------------------------------------------
-- Las del módulo textil
-- ---------------------------------------------------------------------------
-- El textil no cuelga de ninguna tienda: la pertenencia no sirve de criterio,
-- así que el criterio es ser administrador. Los tres usuarios lo son.
DROP POLICY IF EXISTS "Facturas textil lectura" ON storage.objects;
CREATE POLICY "Facturas textil lectura"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'facturas'
  AND (storage.foldername(name))[1] = 'textil'
  AND public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Facturas textil alta" ON storage.objects;
CREATE POLICY "Facturas textil alta"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'facturas'
  AND (storage.foldername(name))[1] = 'textil'
  AND public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Facturas textil reemplazo" ON storage.objects;
CREATE POLICY "Facturas textil reemplazo"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'facturas'
  AND (storage.foldername(name))[1] = 'textil'
  AND public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'facturas'
  AND (storage.foldername(name))[1] = 'textil'
  AND public.has_role(auth.uid(), 'admin')
);

-- Sin política de DELETE a propósito. El PDF de una factura emitida es la
-- representación de un documento fiscal: se regenera encima, no se borra.
