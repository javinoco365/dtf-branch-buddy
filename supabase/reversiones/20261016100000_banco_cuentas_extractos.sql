-- ============================================================================
-- REVERSIÓN DE 20261016100000_banco_cuentas_extractos.sql
-- ============================================================================
-- Quita las cuentas y los extractos. Los movimientos se quedan, pero pierden
-- su cuenta, su extracto y su saldo. BORRA las cuentas y los extractos
-- importados. Solo con autorización.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS public.banco_movimientos_por_cuenta;
ALTER TABLE public.banco_movimientos
  DROP COLUMN IF EXISTS saldo,
  DROP COLUMN IF EXISTS extracto_id,
  DROP COLUMN IF EXISTS cuenta_id;

DROP TABLE IF EXISTS public.banco_extractos;
DROP TABLE IF EXISTS public.banco_cuentas;

COMMIT;
