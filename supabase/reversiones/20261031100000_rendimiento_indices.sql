-- ============================================================================
-- REVERSIÓN de 20261031100000_rendimiento_indices.sql
-- ============================================================================
-- Quita los índices que añadió la migración. No toca datos ni permisos: las
-- consultas devuelven lo mismo, solo más despacio. Ninguno de estos índices
-- respalda una restricción (UNIQUE, clave foránea), así que quitarlos no
-- cambia qué se puede escribir.
-- ============================================================================

DROP INDEX IF EXISTS public.textil_pedido_items_por_pedido;
DROP INDEX IF EXISTS public.textil_factura_items_por_factura;
DROP INDEX IF EXISTS public.textil_presupuesto_items_por_presupuesto;
DROP INDEX IF EXISTS public.pedidos_por_cliente;
DROP INDEX IF EXISTS public.textil_pedidos_por_cliente;
DROP INDEX IF EXISTS public.facturas_por_cliente;
DROP INDEX IF EXISTS public.textil_facturas_por_cliente;
DROP INDEX IF EXISTS public.textil_pedidos_por_fecha;
DROP INDEX IF EXISTS public.textil_facturas_por_fecha;
DROP INDEX IF EXISTS public.pedidos_abiertos;
DROP INDEX IF EXISTS public.enlaces_seguimiento_por_fecha;
DROP INDEX IF EXISTS public.textil_stock_mov_por_pedido;
DROP INDEX IF EXISTS public.tienda_usuarios_por_usuario;
DROP INDEX IF EXISTS public.textil_facturas_rectifica_idx;
