-- ============================================================================
-- REVERSIÓN DE 20261014100000_compras_recibidas.sql
-- ============================================================================
-- Deja textil_compras como estaba antes. BORRA lo escrito en las columnas
-- nuevas (concepto, forma de pago, pagos, descuadres, borrados lógicos): las
-- facturas marcadas como borradas vuelven a contar. Solo con autorización.
-- No vive en migrations/ para que no se aplique sola. Si está aplicada
-- 20261015100000_compras_cola, revertir antes esa: sus índices usan
-- borrada_en y se irían con ella.
-- ============================================================================

DROP INDEX IF EXISTS public.textil_compras_por_trimestre;

ALTER TABLE public.textil_compras
  DROP COLUMN IF EXISTS liquido,
  DROP COLUMN IF EXISTS liquido_calculado,
  DROP COLUMN IF EXISTS total_calculado,
  DROP COLUMN IF EXISTS cuota_irpf,
  DROP COLUMN IF EXISTS cuota_iva,
  DROP COLUMN IF EXISTS ejercicio,
  DROP COLUMN IF EXISTS trimestre,
  DROP COLUMN IF EXISTS borrada_en,
  DROP COLUMN IF EXISTS nota_descuadre,
  DROP COLUMN IF EXISTS liquido_origen,
  DROP COLUMN IF EXISTS fecha_pago,
  DROP COLUMN IF EXISTS estado_pago,
  DROP COLUMN IF EXISTS forma_pago,
  DROP COLUMN IF EXISTS concepto,
  DROP COLUMN IF EXISTS tipo_irpf,
  DROP COLUMN IF EXISTS tipo_iva;
-- Las restricciones de esas columnas se van con ellas.

COMMENT ON COLUMN public.textil_compras.iva IS NULL;
COMMENT ON COLUMN public.textil_compras.irpf IS
  'Retención de IRPF de la factura, en euros. base + iva − irpf = total.';
COMMENT ON COLUMN public.textil_compras.total IS NULL;
