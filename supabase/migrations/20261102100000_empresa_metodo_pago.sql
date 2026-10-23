-- ============================================================================
-- Método de pago en las facturas
-- ============================================================================
-- QUÉ HACE
--   1. empresas.factura_metodo_pago: el texto que sale en negrita bajo
--      «Método de pago» en el PDF de todas las facturas y tickets (tiendas y
--      textil). Uno para toda la sociedad; se cambia en Ajustes > Empresa. Si
--      está vacío, el PDF no lo enseña.
--   2. Lo rellena con la cuenta que dio Javier el 23-10-2026, solo si está
--      vacío (aplicarla dos veces no pisa lo que se haya escrito después).
--
-- No toca facturas: el método de pago es de cómo se imprime, no de lo emitido.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261102100000_empresa_metodo_pago.sql quita la
--   columna.
-- ============================================================================

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS factura_metodo_pago TEXT;

COMMENT ON COLUMN public.empresas.factura_metodo_pago IS
  'Lo que dice el PDF de las facturas bajo «Método de pago». Vacío: no sale.';

UPDATE public.empresas
   SET factura_metodo_pago = 'Transferencia bancaria ES83 0182 0451 4102 0168 9316'
 WHERE factura_metodo_pago IS NULL;

NOTIFY pgrst, 'reload schema';
