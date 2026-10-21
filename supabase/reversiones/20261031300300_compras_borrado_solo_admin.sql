-- ============================================================================
-- REVERSIÓN de 20261031300300_compras_borrado_solo_admin.sql
-- ============================================================================
-- Quita el trigger y su función. No toca datos.
--
-- OJO: vuelve a abrir R2: un editor puede marcar como borrada una factura
-- recibida registrada con su sesión.
--
-- Orden: antes que la reversión de 20261031200100 (quita rol_exigir_quien).
-- ============================================================================

DROP TRIGGER IF EXISTS textil_compras_borrado_solo_admin ON public.textil_compras;
DROP FUNCTION IF EXISTS public.textil_compras_borrado_solo_admin();
