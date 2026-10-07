-- ============================================================================
-- Crear el bucket de Storage donde se guardan los PDF de facturas y tickets
-- ============================================================================
--
-- EL PROBLEMA
--   Al emitir una factura sale:
--     «Factura … emitida, pero no se pudo generar el PDF: … Bucket not found»
--
--   La factura se emite bien (número, fecha y snapshots están en la base),
--   pero su PDF no tiene dónde guardarse. Las migraciones de facturación
--   crearon las políticas del bucket 'facturas' y dejaron escrito que el bucket
--   había que crearlo a mano desde el panel de Supabase. En producción no se
--   creó nunca.
--
-- QUÉ HACE
--   Crea el bucket 'facturas', PRIVADO: una factura lleva el NIF y la
--   dirección del cliente y no se sirve en abierto. Los PDF se abren con URL
--   firmada, como ya hace el código. Las políticas de lectura y escritura ya
--   existen (20260903320000_pdf_textil_storage.sql).
--
--   Solo PDF y hasta 10 MB por fichero.
--
-- REVERSIBLE
--   Sí, mientras esté vacío. Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('facturas', 'facturas', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
