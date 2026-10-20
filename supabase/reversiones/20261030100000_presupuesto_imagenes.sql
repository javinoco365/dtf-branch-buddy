-- ============================================================================
-- REVERSIÓN de 20261030100000_presupuesto_imagenes.sql
-- ============================================================================
-- Solo con autorización expresa de Javier: borra la tabla de imágenes de los
-- presupuestos. Los presupuestos y sus líneas no se tocan; sus PDF vuelven a
-- salir sin imágenes. Las filas de auditoría que se hayan escrito se quedan
-- (la tabla de auditoría es append-only).
--
-- El bucket 'presupuestos' NO se borra aquí: Supabase no deja borrar un
-- bucket con ficheros y vaciarlo es borrar datos. Si se quiere quitar, se
-- vacía y se borra a mano desde el panel de Storage, también con permiso.
-- Sin la tabla, la política de lectura del bucket deja de tener sentido y se
-- quita con las otras dos.
-- ============================================================================

DROP POLICY IF EXISTS "presupuestos_imagenes_lectura" ON storage.objects;
DROP POLICY IF EXISTS "presupuestos_imagenes_alta" ON storage.objects;
DROP POLICY IF EXISTS "presupuestos_imagenes_borrado" ON storage.objects;

DROP TABLE IF EXISTS public.presupuesto_imagenes;
DROP FUNCTION IF EXISTS public.presupuesto_imagen_visible(UUID, UUID);
DROP FUNCTION IF EXISTS public.presupuesto_imagenes_empresa();

NOTIFY pgrst, 'reload schema';
