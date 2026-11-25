-- ============================================================================
-- DTF UV: corregir el coste congelado de los pedidos (15 → 13)
-- ============================================================================
-- Prueba 20261125100000_coste_uv_13_corregir.sql, en una transacción que se
-- deshace al final (la migración trae su propio BEGIN/COMMIT: aquí se repite
-- su cuerpo sin ellos).
BEGIN;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda E9', 'tienda-e9');
-- Un pedido con UV congelado a 15 (antes del cambio) y su línea UV.
UPDATE public.empresas SET coste_uv_metro = 15
 WHERE id = (SELECT empresa_id FROM public.tiendas WHERE slug = 'tienda-e9');
INSERT INTO public.pedidos (tienda_id, empresa_id, numero, metros_uv)
  SELECT id, empresa_id, 'E9-UV', 2 FROM public.tiendas WHERE slug = 'tienda-e9';
-- El coste de la línea se pone a mano: en este banco, la prueba B4 vuelve a
-- aplicar la versión de octubre del disparador de las líneas, sin el UV. En
-- producción la línea UV copia los 15 del pedido.
INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total, linea, coste_unit_snapshot)
  SELECT id, 'DTF UV', 2, 'm', 20, 21, 40, 8.4, 48.4, 'uv', 15 FROM public.pedidos WHERE numero = 'E9-UV';
-- Ahora la empresa ya lo tiene a 13 en Configuración.
UPDATE public.empresas SET coste_uv_metro = 13
 WHERE id = (SELECT empresa_id FROM public.tiendas WHERE slug = 'tienda-e9');

SELECT CASE WHEN p.coste_uv_snapshot = 15 AND i.coste_unit_snapshot = 15
            THEN 'BIEN  1. antes de corregir, el pedido y su línea están congelados a 15'
            ELSE 'MAL   1. el punto de partida no es el esperado: ' || p.coste_uv_snapshot || ' / ' || i.coste_unit_snapshot END
  FROM public.pedidos p JOIN public.pedido_items i ON i.pedido_id = p.id
 WHERE p.numero = 'E9-UV';

-- 2. El disparador no deja cambiarlo por las buenas.
UPDATE public.pedidos SET coste_uv_snapshot = 13 WHERE numero = 'E9-UV';
SELECT CASE WHEN coste_uv_snapshot = 15
            THEN 'BIEN  2. sin la corrección, el coste congelado no cambia'
            ELSE 'MAL   2. el coste congelado ha cambiado sin la corrección' END
  FROM public.pedidos WHERE numero = 'E9-UV';

-- 3. La corrección (el cuerpo de la migración).
ALTER TABLE public.pedidos DISABLE TRIGGER pedidos_coste_uv_congelado;
UPDATE public.pedidos p SET coste_uv_snapshot = 13
  FROM public.empresas e
 WHERE e.id = p.empresa_id AND e.coste_uv_metro = 13 AND p.coste_uv_snapshot = 15;
ALTER TABLE public.pedidos ENABLE TRIGGER pedidos_coste_uv_congelado;
UPDATE public.pedido_items i SET coste_unit_snapshot = 13
  FROM public.pedidos p JOIN public.empresas e ON e.id = p.empresa_id
 WHERE p.id = i.pedido_id AND e.coste_uv_metro = 13 AND i.linea = 'uv' AND i.coste_unit_snapshot = 15;

SELECT CASE WHEN p.coste_uv_snapshot = 13 AND i.coste_unit_snapshot = 13
            THEN 'BIEN  3. el pedido y su línea UV quedan a 13'
            ELSE 'MAL   3. no se ha corregido: ' || p.coste_uv_snapshot || ' / ' || i.coste_unit_snapshot END
  FROM public.pedidos p JOIN public.pedido_items i ON i.pedido_id = p.id
 WHERE p.numero = 'E9-UV';

-- 4. El disparador vuelve a estar activo: el coste sigue congelado.
UPDATE public.pedidos SET coste_uv_snapshot = 99 WHERE numero = 'E9-UV';
SELECT CASE WHEN coste_uv_snapshot = 13
            THEN 'BIEN  4. después, el coste vuelve a estar congelado'
            ELSE 'MAL   4. el disparador ha quedado desactivado' END
  FROM public.pedidos WHERE numero = 'E9-UV';

ROLLBACK;
