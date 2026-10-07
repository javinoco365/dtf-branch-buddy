-- ============================================================================
-- CLAVE DEL LECTOR DE FACTURAS EN VAULT
-- ============================================================================
--
-- QUÉ RESUELVE
--   El lector de facturas con IA solo buscaba la clave en la variable
--   ANTHROPIC_API_KEY del despliegue. La clave está guardada en el Vault de
--   Supabase con el nombre «facturas_key», que es donde deben vivir las
--   credenciales de terceros.
--
-- QUÉ HACE
--   clave_lector_facturas(): devuelve el secreto «facturas_key» del Vault (el
--   más reciente si hubiera varios con ese nombre). Solo la puede llamar el rol
--   de servicio: ni un usuario ni el navegador pueden leerla.
--
-- REVERSIBLE
--   Sí: DROP FUNCTION public.clave_lector_facturas();
--   No toca ninguna tabla. Se puede aplicar dos veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clave_lector_facturas()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ds.decrypted_secret
    FROM vault.decrypted_secrets ds
   WHERE ds.name = 'facturas_key'
   ORDER BY ds.created_at DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.clave_lector_facturas() IS
  'La clave del lector de facturas (secreto «facturas_key» del Vault). Solo service_role.';

REVOKE EXECUTE ON FUNCTION public.clave_lector_facturas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clave_lector_facturas() TO service_role;
