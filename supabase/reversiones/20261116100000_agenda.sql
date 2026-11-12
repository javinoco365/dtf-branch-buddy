-- ============================================================================
-- REVERSIÓN de 20261116100000_agenda.sql
-- ============================================================================
-- Quita la Agenda de la base: tareas, su historial y las categorías. Se pierden
-- todas las tareas y categorías creadas. Las filas que hayan dejado en
-- auditoria se quedan (es append-only). Pídelo antes: son DROP.
-- ============================================================================

DROP TABLE IF EXISTS public.agenda_tarea_historial;
DROP TABLE IF EXISTS public.agenda_tareas;
DROP TABLE IF EXISTS public.agenda_categorias;
DROP FUNCTION IF EXISTS public.agenda_tarea_historial_registrar();
DROP FUNCTION IF EXISTS public.agenda_tarea_preparar();

NOTIFY pgrst, 'reload schema';
