-- ============================================================================
-- REVERSIÓN de 20261117100000_pedido_necesita_factura.sql
-- ============================================================================
-- Quita la regla que impide un ticket a un pedido que pidió factura y la
-- columna `pedidos.necesita_factura`. Se pierde qué pedidos la marcaron; la
-- siguiente sincronización no la vuelve a traer hasta reaplicar la migración.
-- Pídelo antes: es un DROP COLUMN.
-- ============================================================================

DROP TRIGGER IF EXISTS facturas_ticket_no_si_pide_factura ON public.facturas;
DROP FUNCTION IF EXISTS public.ticket_no_si_pide_factura();
ALTER TABLE public.pedidos DROP COLUMN IF EXISTS necesita_factura;

NOTIFY pgrst, 'reload schema';
