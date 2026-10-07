-- ============================================================================
-- REVERSIÓN DE 20261015100000_compras_cola.sql
-- ============================================================================
-- Quita la cola de revisión y los índices de duplicados, y repone la
-- restricción compra_unica de antes. BORRA los motivos, la confianza y las
-- huellas. Si hay dos compras con el mismo proveedor y número, compra_unica
-- no se puede reponer y la reversión falla sin cambiar nada: hay que
-- resolverlas antes. Solo con autorización.
-- ============================================================================

BEGIN;

ALTER TABLE public.textil_compras
  ADD CONSTRAINT compra_unica UNIQUE (empresa_id, proveedor, numero);

DROP INDEX IF EXISTS public.textil_compras_cola;
DROP INDEX IF EXISTS public.textil_compras_factura_unica;
DROP INDEX IF EXISTS public.textil_compras_fichero_unico;

ALTER TABLE public.textil_compras
  DROP COLUMN IF EXISTS numero_clave,
  DROP COLUMN IF EXISTS proveedor_clave,
  DROP COLUMN IF EXISTS fichero_huella,
  DROP COLUMN IF EXISTS confianza,
  DROP COLUMN IF EXISTS revision_motivo,
  DROP COLUMN IF EXISTS revision;

COMMIT;
