-- ============================================================================
-- Rutas del bucket de facturas: una carpeta que no es un UUID no rompe nada
-- ============================================================================

-- 1. El cast directo revienta. Esta es la prueba de que el problema era real.
DO $$
DECLARE v UUID;
BEGIN
  v := (storage.foldername('textil/abc.pdf'))[1]::UUID;
  RAISE NOTICE 'MAL   1. el cast directo no fallo, la premisa era falsa';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  1. el cast directo revienta: por eso hacia falta carpeta_uuid';
END $$;

-- 2. carpeta_uuid devuelve NULL en vez de reventar.
SELECT CASE WHEN public.carpeta_uuid('textil/abc.pdf') IS NULL
            THEN 'BIEN  2. carpeta_uuid devuelve NULL con una carpeta que no es UUID'
            ELSE 'MAL   2. devolvio algo' END;

-- 3. Y sigue devolviendo el UUID cuando lo es.
SELECT CASE WHEN public.carpeta_uuid('11111111-1111-4111-8111-111111111111/f.pdf')
                 = '11111111-1111-4111-8111-111111111111'::UUID
            THEN 'BIEN  3. con una carpeta que si es UUID, lo devuelve'
            ELSE 'MAL   3. no devolvio el uuid' END;

-- 4. Un listado mezclando las dos formas no revienta. Es el caso que rompia:
--    basta un objeto en textil/ para tumbar el listado entero del bucket.
SELECT CASE WHEN count(*) = 3
            THEN 'BIEN  4. un listado con rutas mezcladas no revienta'
            ELSE 'MAL   4. conto ' || count(*) END
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111/a.pdf'),
  ('textil/b.pdf'),
  ('no-es-un-uuid/c.pdf')
) AS r(name)
WHERE public.carpeta_uuid(r.name) IS NOT NULL OR public.carpeta_uuid(r.name) IS NULL;

-- 5. Las políticas de tienda ya no llevan el cast directo.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  5. ninguna politica del bucket usa el cast que revienta'
            ELSE 'MAL   5. quedan: ' || string_agg(policyname, ', ') END
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%foldername%'
  AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%uuid%'
  AND (COALESCE(qual, '') || COALESCE(with_check, '')) NOT LIKE '%carpeta_uuid%';

-- 6. Y el textil tiene las suyas, sin borrado: el PDF de una factura emitida
--    se regenera encima, no se borra.
SELECT CASE WHEN count(*) FILTER (WHERE cmd = 'SELECT') = 1
             AND count(*) FILTER (WHERE cmd = 'INSERT') = 1
             AND count(*) FILTER (WHERE cmd = 'UPDATE') = 1
             AND count(*) FILTER (WHERE cmd = 'DELETE') = 0
            THEN 'BIEN  6. textil tiene lectura, alta y reemplazo, y ningun borrado'
            ELSE 'MAL   6. politicas textil mal repartidas' END
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'Facturas textil%';
