-- ============================================================================
-- REVERSIÓN de 20261025100000_conciliacion_pendientes.sql
-- ============================================================================
-- Quita las cinco funciones de solo lectura. No toca ninguna fila.
--
-- Sin ellas, la pantalla de conciliación sigue con el motor (compras,
-- traspasos y «Por revisar»), pero lee la ventana de las tablas como antes:
-- los 2000 más recientes de cada cosa, cobrados o no. Y avisa de que falta
-- esta migración para mirar solo lo pendiente.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.banco_conciliacion_cuantos();
DROP FUNCTION IF EXISTS public.banco_enlaces();
DROP FUNCTION IF EXISTS public.banco_movimientos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos();

NOTIFY pgrst, 'reload schema';

COMMIT;
