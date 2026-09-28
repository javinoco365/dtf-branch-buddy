-- ============================================================================
-- Pedidos pendientes de cobro
-- ============================================================================
-- Lo que se comprueba: que la vista enseña lo que falta por cobrar de tiendas
-- y textil, y nada más: ni lo cobrado entero, ni lo cancelado, ni el pedido
-- web ya pagado.
--
-- Se vuelve a aplicar la migración: 20_auditoria_autor.sql concede ALL sobre
-- todas las tablas a anon y authenticated para sus propias pruebas, y eso
-- taparía el REVOKE que se comprueba en la 7. De paso prueba que se puede
-- aplicar dos veces.
\ir ../migrations/20260930100000_pedidos_pendientes_cobro.sql

DO $$
DECLARE v_tienda UUID;
BEGIN
  INSERT INTO public.tiendas (id, nombre, slug)
  VALUES ('a9a9a9a9-0000-4000-8000-0000000000a1', 'Tienda pendientes', 'tienda-pendientes')
  RETURNING id INTO v_tienda;

  INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, woo_order_id)
  VALUES
    -- manual, cobrado en parte: pendiente 60
    ('a9a9a9a9-0000-4000-8000-000000000001', v_tienda, 'P-PARCIAL', 'pendiente', 100, 'manual', NULL),
    -- manual, cobrado entero: fuera
    ('a9a9a9a9-0000-4000-8000-000000000002', v_tienda, 'P-ENTERO', 'pendiente', 50, 'manual', NULL),
    -- manual, cancelado: fuera
    ('a9a9a9a9-0000-4000-8000-000000000003', v_tienda, 'P-CANCELADO', 'cancelado', 70, 'manual', NULL),
    -- web pagado: su cobro web lo salda, fuera
    ('a9a9a9a9-0000-4000-8000-000000000004', v_tienda, 'W-PAGADO', 'en_produccion', 80, 'woocommerce', 99001),
    -- web sin pagar (transferencia en espera): pendiente 45
    ('a9a9a9a9-0000-4000-8000-000000000005', v_tienda, 'W-ESPERA', 'pendiente', 45, 'woocommerce', 99002);

  INSERT INTO public.textil_pedidos (id, numero, estado, cliente_nombre, total)
  VALUES
    ('a9a9a9a9-0000-4000-8000-000000000011', 'TPD-A9-1', 'pendiente', 'Peña La Charanga', 50),
    ('a9a9a9a9-0000-4000-8000-000000000012', 'TPD-A9-2', 'cancelado', 'Nadie', 30);
END $$;

SELECT public.registrar_cobro('a9a9a9a9-0000-4000-8000-000000000001', NULL, '2026-09-20', 40, 'tarjeta');
SELECT public.registrar_cobro('a9a9a9a9-0000-4000-8000-000000000002', NULL, '2026-09-20', 50, 'transferencia');
SELECT public.registrar_cobro(NULL, 'a9a9a9a9-0000-4000-8000-000000000011', '2026-09-21', 20, 'tarjeta');

-- 1. El pedido cobrado en parte sale con lo que le falta y su último cobro.
SELECT CASE WHEN count(*) = 1 AND min(total) = 100 AND min(cobrado) = 40
             AND min(pendiente) = 60 AND min(ultimo_cobro) = '2026-09-20'
             AND min(tipo) = 'tienda' AND min(origen) = 'manual'
            THEN 'BIEN  1. cobrado en parte: sale con 60 pendientes'
            ELSE 'MAL   1. pedido parcial: ' || count(*) || ' fila(s)' END
FROM public.pedidos_pendientes_cobro WHERE id = 'a9a9a9a9-0000-4000-8000-000000000001';

-- 2. Ni el cobrado entero, ni el cancelado, ni el web pagado.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  2. lo cobrado, lo cancelado y lo pagado en la web no salen'
            ELSE 'MAL   2. salen ' || count(*) || ' pedido(s) que no deben' END
FROM public.pedidos_pendientes_cobro
WHERE id IN ('a9a9a9a9-0000-4000-8000-000000000002', 'a9a9a9a9-0000-4000-8000-000000000003',
             'a9a9a9a9-0000-4000-8000-000000000004');

-- 3. El web sin pagar sí sale, marcado como web.
SELECT CASE WHEN count(*) = 1 AND min(pendiente) = 45 AND min(origen) = 'woocommerce'
            THEN 'BIEN  3. el pedido web sin pagar sale como pendiente'
            ELSE 'MAL   3. pedido web sin pagar: ' || count(*) END
FROM public.pedidos_pendientes_cobro WHERE id = 'a9a9a9a9-0000-4000-8000-000000000005';

-- 4. El textil también, y el textil cancelado no.
SELECT CASE WHEN count(*) FILTER (WHERE id = 'a9a9a9a9-0000-4000-8000-000000000011'
                                    AND tipo = 'textil' AND pendiente = 30
                                    AND tienda_id IS NULL) = 1
             AND count(*) FILTER (WHERE id = 'a9a9a9a9-0000-4000-8000-000000000012') = 0
            THEN 'BIEN  4. el textil sale con lo suyo; el cancelado no'
            ELSE 'MAL   4. textil en la vista mal' END
FROM public.pedidos_pendientes_cobro;

-- 5. Al cobrar lo que falta, desaparece.
SELECT public.registrar_cobro('a9a9a9a9-0000-4000-8000-000000000001', NULL, '2026-09-22', 60, 'tarjeta');
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  5. al cobrar lo que falta, sale de pendientes'
            ELSE 'MAL   5. sigue pendiente tras cobrarlo entero' END
FROM public.pedidos_pendientes_cobro WHERE id = 'a9a9a9a9-0000-4000-8000-000000000001';

-- 6. La vista respeta la RLS de quien la lee.
SELECT CASE WHEN c.reloptions @> ARRAY['security_invoker=true']
            THEN 'BIEN  6. la vista respeta la RLS (security_invoker)'
            ELSE 'MAL   6. la vista se salta la RLS' END
FROM pg_class c WHERE c.oid = 'public.pedidos_pendientes_cobro'::regclass;

-- 7. anon no la lee.
SELECT CASE WHEN NOT has_table_privilege('anon', 'public.pedidos_pendientes_cobro', 'SELECT')
            THEN 'BIEN  7. anon no lee la vista'
            ELSE 'MAL   7. anon puede leer la vista' END;
