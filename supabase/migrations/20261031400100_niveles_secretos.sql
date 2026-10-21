-- ============================================================================
-- Niveles: tres secretos que el visor y el editor podían leer
-- ============================================================================
--
-- EL PROBLEMA
--   20261031400000 hace que is_tienda_member() y es_miembro_empresa() sean
--   true para cualquier nivel activo. Con eso, tres cosas que se dan por
--   secretas quedaban al alcance de cualquier visor o editor:
--
--   1. smtp_estado() (SECURITY DEFINER, para authenticated) filtraba con
--      es_miembro_empresa(): un visor sin tiendas leía host, puerto y usuario
--      del servidor de correo de cualquier tienda. Es lo mismo que 400000
--      oculta en la auditoría porque «dice host y usuario».
--   2. tienda_seguimiento_config.api_key_ref, que auditoria_enmascarar() trata
--      como sensible (20261023110000), se leía con la política de lectura por
--      tienda: ahora, todas las tiendas para cualquier nivel activo.
--   3. La política de storage «compras_lectura» (20260903260000) era solo
--      bucket_id = 'compras': cualquier token válido (un desactivado mientras
--      le dura el token, o un alta a medias sin nivel) descargaba los PDF de
--      todas las facturas de proveedores.
--
-- QUÉ HACE
--   1. smtp_estado(): con sesión, solo un admin activo recibe filas. Sin sesión
--      (servidor con service role) sigue igual.
--   2. tienda_seguimiento_config: authenticated pierde SELECT sobre la tabla y
--      lo recupera columna a columna, todas salvo api_key_ref. Nadie la lee
--      desde el navegador (la aplicación no la usa); el servidor, con service
--      role, sí. Insertar y modificar no cambian.
--   3. «compras_lectura»: además del bucket, nivel activo (rol_puede_ver()).
--      La aplicación lee esos ficheros solo desde el servidor
--      (adminComoUsuario, service role), así que no le afecta.
--
-- DEPENDE DE 20261031400000 (rol_puede_ver).
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031400100_niveles_secretos.sql
-- (repone smtp_estado() de 300000, el SELECT de tabla entero y la política
-- anterior). No toca datos.
-- ============================================================================

-- ---- 1. SMTP: solo admin ----------------------------------------------------
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
     -- Sin sesión (servidor), todo; con sesión, solo un admin activo.
     AND (auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'))
   ORDER BY c.tienda_id NULLS LAST
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.smtp_estado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.smtp_estado(UUID) TO authenticated, service_role;

-- ---- 2. api_key_ref del transportista: fuera del SELECT del navegador -------
REVOKE SELECT ON public.tienda_seguimiento_config FROM authenticated;
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.tienda_seguimiento_config'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'api_key_ref';
  EXECUTE format('GRANT SELECT (%s) ON public.tienda_seguimiento_config TO authenticated', v_cols);
END $$;
-- Un permiso de columna suelto que hubiera quedado de antes, fuera.
REVOKE SELECT (api_key_ref) ON public.tienda_seguimiento_config FROM authenticated;

-- ---- 3. PDF de facturas de proveedores: solo con nivel activo ---------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'compras_lectura') THEN
    ALTER POLICY "compras_lectura" ON storage.objects
      USING (bucket_id = 'compras' AND (SELECT public.rol_puede_ver(auth.uid())));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
