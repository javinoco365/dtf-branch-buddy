-- ============================================================================
-- REVERSIÓN de 20261025100000_conciliacion_pendientes.sql
-- ============================================================================
-- Quita las cuatro funciones de solo lectura. No toca ninguna fila.
--
-- Sin ellas, la pantalla de conciliación vuelve a la de antes (ingresos contra
-- facturas emitidas, uno a uno) y dice qué migración falta.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.banco_enlaces();
DROP FUNCTION IF EXISTS public.banco_movimientos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos();

NOTIFY pgrst, 'reload schema';

COMMIT;
