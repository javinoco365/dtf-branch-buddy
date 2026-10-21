-- Reversión de 20261031400100_niveles_secretos.sql
--
-- Repone smtp_estado() de 20261031300000 (filtra por es_miembro_empresa()),
-- el SELECT entero de tienda_seguimiento_config para authenticated y la
-- política «compras_lectura» de 20260903260000 (solo el bucket). No toca datos.

CREATE OR REPLACE FUNCTION public.smtp_estado(_tienda_id UUID DEFAULT NULL)
RETURNS TABLE(ambito TEXT, host TEXT, puerto INTEGER, usuario TEXT, tiene_clave BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN c.tienda_id IS NULL THEN 'general' ELSE 'tienda' END,
         c.host, c.puerto, c.usuario, c.clave_secret_id IS NOT NULL
    FROM public.smtp_config c
   WHERE ((_tienda_id IS NOT NULL
           AND (c.tienda_id = _tienda_id
                OR (c.tienda_id IS NULL
                    AND c.empresa_id = (SELECT t.empresa_id FROM public.tiendas t
                                         WHERE t.id = _tienda_id))))
       OR (_tienda_id IS NULL AND c.tienda_id IS NULL))
     AND (auth.uid() IS NULL OR public.es_miembro_empresa(auth.uid(), c.empresa_id))
   ORDER BY c.tienda_id NULLS LAST
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.smtp_estado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.smtp_estado(UUID) TO authenticated, service_role;

-- Quitar los permisos por columna y volver al SELECT de tabla.
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.tienda_seguimiento_config'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('REVOKE SELECT (%s) ON public.tienda_seguimiento_config FROM authenticated', v_cols);
END $$;
GRANT SELECT ON public.tienda_seguimiento_config TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'compras_lectura') THEN
    ALTER POLICY "compras_lectura" ON storage.objects
      USING (bucket_id = 'compras');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
