-- ============================================================================
-- REVERSIÓN de 20261106100000_factura_metodo_pago.sql
-- ============================================================================
-- Quita las envolturas, los triggers y las columnas. Las facturas emitidas
-- desde entonces pierden el método elegido: su PDF pasa a enseñar el de
-- Ajustes > Empresa.
-- ============================================================================

DROP FUNCTION IF EXISTS public.emitir_factura_con_pago(
  TEXT, UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.emitir_factura_textil_con_pago(
  TEXT, UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID, UUID);

DROP TRIGGER IF EXISTS facturas_metodo_pago_de_sesion ON public.facturas;
DROP TRIGGER IF EXISTS textil_facturas_metodo_pago_de_sesion ON public.textil_facturas;
DROP FUNCTION IF EXISTS public.factura_metodo_pago_de_sesion();

ALTER TABLE public.facturas DROP COLUMN IF EXISTS metodo_pago;
ALTER TABLE public.textil_facturas DROP COLUMN IF EXISTS metodo_pago;

NOTIFY pgrst, 'reload schema';
