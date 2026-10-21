-- ============================================================================
-- RENDIMIENTO 1/2: ÍNDICES QUE FALTAN PARA LAS CONSULTAS REALES DE LA APP
-- ============================================================================
--
-- QUÉ HACE
--   Solo añade índices (CREATE INDEX IF NOT EXISTS). No cambia datos, ni
--   permisos, ni resultados de ninguna consulta: solo lo que tarda.
--   Se puede aplicar dos veces sin efecto.
--
-- QUÉ NO AÑADE (ya existen)
--   facturas(pedido_id) y textil_facturas(textil_pedido_id)  20261004100100_tickets.sql
--   facturas(rectifica_a_id)                                 20260902130000_motor_facturacion.sql
--   cobros(pedido_id)                                        20260929100000_cobros.sql
--   pedidos(tienda_id, fecha_pedido)                         20260902120300_estados_pedido.sql
--
-- BLOQUEOS
--   CREATE INDEX normal: bloquea las escrituras de cada tabla mientras se
--   construye (segundos con el volumen de hoy). Si alguna tabla tuviera
--   cientos de miles de filas, se puede crear cada índice a mano con
--   CREATE INDEX CONCURRENTLY, fuera de una transacción.
--
-- REVERSIÓN
--   supabase/reversiones/20261031100000_rendimiento_indices.sql (DROP INDEX).
-- ============================================================================

-- Líneas textil: se leen incrustadas en las listas (items:textil_*_items(*))
-- y por pedido, factura o presupuesto al abrir, editar y borrar en cascada.
-- Sin índice, cada documento de la lista recorre la tabla entera de líneas.
CREATE INDEX IF NOT EXISTS textil_pedido_items_por_pedido
  ON public.textil_pedido_items (pedido_id);
CREATE INDEX IF NOT EXISTS textil_factura_items_por_factura
  ON public.textil_factura_items (factura_id);
CREATE INDEX IF NOT EXISTS textil_presupuesto_items_por_presupuesto
  ON public.textil_presupuesto_items (presupuesto_id);

-- Ficha de cliente (historial) y ON DELETE SET NULL al borrar o fusionar fichas.
CREATE INDEX IF NOT EXISTS pedidos_por_cliente
  ON public.pedidos (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_pedidos_por_cliente
  ON public.textil_pedidos (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS facturas_por_cliente
  ON public.facturas (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_facturas_por_cliente
  ON public.textil_facturas (cliente_id) WHERE cliente_id IS NOT NULL;

-- Periodos del textil (Gerencia, Resumen diario, cobros por fecha de pedido)
-- y listas ordenadas por fecha.
CREATE INDEX IF NOT EXISTS textil_pedidos_por_fecha
  ON public.textil_pedidos (fecha DESC, id);
CREATE INDEX IF NOT EXISTS textil_facturas_por_fecha
  ON public.textil_facturas (fecha DESC, id);

-- Taller (Gerencia › Producción): pedidos abiertos. El predicado es el de
-- ESTADOS_ABIERTOS (src/dominio/produccion.ts); si esa lista cambia o la app
-- pasa a estado_produccion, este índice deja de usarse (nunca da resultados
-- distintos, solo más lentos).
CREATE INDEX IF NOT EXISTS pedidos_abiertos
  ON public.pedidos (id)
  WHERE estado IN ('pendiente', 'en_produccion', 'imprimiendo', 'listo');

-- Envíos del periodo (Gerencia): enlaces por fecha de alta.
CREATE INDEX IF NOT EXISTS enlaces_seguimiento_por_fecha
  ON public.enlaces_seguimiento (created_at);

-- Coste de venta textil por pedido (Gerencia, devoluciones de stock).
CREATE INDEX IF NOT EXISTS textil_stock_mov_por_pedido
  ON public.textil_stock_movimientos (textil_pedido_id) WHERE textil_pedido_id IS NOT NULL;

-- is_tienda_member(), es_miembro_empresa() y mis_tiendas() buscan por
-- user_id; la clave primaria de tienda_usuarios empieza por tienda_id.
CREATE INDEX IF NOT EXISTS tienda_usuarios_por_usuario
  ON public.tienda_usuarios (user_id, tienda_id);

-- Rectificativas textil que apuntan a una factura. facturas ya lo tiene
-- (facturas_rectifica_idx); textil_facturas no. Lo usan documentosDe
-- (src/lib/gerencia.ts) y factura_borrar_ultima / sustituir
-- (20261004100100_tickets.sql), que comprueban que nada rectifica la factura.
CREATE INDEX IF NOT EXISTS textil_facturas_rectifica_idx
  ON public.textil_facturas (rectifica_a_id) WHERE rectifica_a_id IS NOT NULL;
