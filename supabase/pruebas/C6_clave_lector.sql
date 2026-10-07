-- ============================================================================
-- La clave del lector de facturas sale del Vault, y solo para el servidor
-- ============================================================================

SELECT CASE WHEN public.clave_lector_facturas() IS NULL
            THEN 'BIEN  1. sin secreto en el Vault, no hay clave'
            ELSE 'MAL   1. devolvió una clave que no existe' END;

SELECT vault.create_secret('clave-vieja', 'facturas_key', 'antigua');
SELECT vault.create_secret('otra-cosa', 'smtp_x', 'no es esta');
UPDATE vault.secrets SET created_at = now() - interval '1 day' WHERE secret = 'clave-vieja';
SELECT vault.create_secret('clave-nueva', 'facturas_key', 'la buena');
SELECT CASE WHEN public.clave_lector_facturas() = 'clave-nueva'
            THEN 'BIEN  2. devuelve el secreto «facturas_key» más reciente'
            ELSE 'MAL   2. devolvió ' || COALESCE(public.clave_lector_facturas(), 'nada') END;

SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.clave_lector_facturas();
  RAISE WARNING 'MAL   3. un usuario pudo leer la clave';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'BIEN  3. un usuario no puede leer la clave';
END $$;
RESET ROLE;

DELETE FROM vault.secrets WHERE name IN ('facturas_key', 'smtp_x');
