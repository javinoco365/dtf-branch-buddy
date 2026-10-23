-- ============================================================================
-- REVERSIÓN de 20261102100000_empresa_metodo_pago.sql
-- ============================================================================
-- Quita la columna. Los PDF ya guardados no cambian; los nuevos salen sin
-- método de pago.
-- ============================================================================

ALTER TABLE public.empresas DROP COLUMN IF EXISTS factura_metodo_pago;

NOTIFY pgrst, 'reload schema';
