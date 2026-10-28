-- ============================================================================
-- REVERSIÓN de 20261103100000_primer_pedido.sql
-- ============================================================================
-- Quita las funciones, la vista y las dos columnas. Se pierden las decisiones
-- guardadas («nuevo» o «repite»); los pedidos no cambian en nada más.
-- ============================================================================

DROP FUNCTION IF EXISTS public.primer_pedido_parecidos(TEXT, UUID);
DROP FUNCTION IF EXISTS public.primer_pedido_resumen(UUID[], UUID[]);
DROP VIEW IF EXISTS public.pedidos_huella_cliente;
DROP FUNCTION IF EXISTS public.cliente_norm_telefono(TEXT);
DROP FUNCTION IF EXISTS public.cliente_norm_email(TEXT);
DROP FUNCTION IF EXISTS public.cliente_norm_texto(TEXT);

ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_primer_pedido_decision_valida;
ALTER TABLE public.textil_pedidos DROP CONSTRAINT IF EXISTS textil_pedidos_primer_pedido_decision_valida;
ALTER TABLE public.pedidos DROP COLUMN IF EXISTS primer_pedido_decision;
ALTER TABLE public.textil_pedidos DROP COLUMN IF EXISTS primer_pedido_decision;

NOTIFY pgrst, 'reload schema';
