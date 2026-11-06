-- ============================================================================
-- Bizum como forma de cobro
-- ============================================================================
-- Prueba 20261107100000_cobro_bizum.sql. El arnés ya la ha aplicado con el
-- resto; aquí se vuelve a aplicar (tiene que poder repetirse) y los datos van
-- en una transacción que se deshace al final.
\ir ../migrations/20261107100000_cobro_bizum.sql

BEGIN;

INSERT INTO public.tiendas (id, nombre, slug)
VALUES ('d7d7d7d7-0000-4000-8000-0000000000a1', 'Tienda D7', 'tienda-d7');
INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, fecha_pedido)
VALUES ('d7d7d7d7-0000-4000-8000-000000000001', 'd7d7d7d7-0000-4000-8000-0000000000a1',
        'D7-1', 'pendiente', 50, 'manual', '2026-11-06 10:00:00+00');

-- 1. El tipo tiene el valor nuevo, detrás de transferencia.
SELECT CASE WHEN enum_range(NULL::public.cobro_metodo)::TEXT[]
                 @> ARRAY['efectivo', 'tarjeta', 'transferencia', 'bizum']
             AND array_position(enum_range(NULL::public.cobro_metodo)::TEXT[], 'bizum')
               = array_position(enum_range(NULL::public.cobro_metodo)::TEXT[], 'transferencia') + 1
            THEN 'BIEN  1. cobro_metodo tiene bizum, detrás de transferencia'
            ELSE 'MAL   1. cobro_metodo = ' || enum_range(NULL::public.cobro_metodo)::TEXT END;

-- 2. Un cobro por Bizum se registra y no pasa por Caja.
DO $$
DECLARE v_id UUID; v_antes BIGINT; r RECORD;
BEGIN
  SELECT count(*) INTO v_antes FROM public.caja_movimientos;
  v_id := public.registrar_cobro('d7d7d7d7-0000-4000-8000-000000000001', NULL,
            DATE '2026-11-06', 20, 'bizum');
  SELECT metodo::TEXT AS metodo, importe, caja_movimiento_id INTO r FROM public.cobros WHERE id = v_id;
  IF r.metodo = 'bizum' AND r.importe = 20 AND r.caja_movimiento_id IS NULL
     AND (SELECT count(*) FROM public.caja_movimientos) = v_antes THEN
    RAISE NOTICE 'BIEN  2. el cobro por Bizum se guarda como bizum y no crea apunte de caja';
  ELSE
    RAISE WARNING 'MAL   2. cobro % % caja %', r.metodo, r.importe, r.caja_movimiento_id;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   2. rechazado: %', SQLERRM;
END $$;

-- 3. Bizum con concepto de caja: no, eso es solo del efectivo.
DO $$
BEGIN
  PERFORM public.registrar_cobro('d7d7d7d7-0000-4000-8000-000000000001', NULL,
            DATE '2026-11-06', 5, 'bizum', false,
            (SELECT id FROM public.caja_conceptos WHERE categoria = 'ingreso' LIMIT 1));
  RAISE WARNING 'MAL   3. un Bizum ha ido a caja';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. un Bizum no lleva concepto de caja: %', SQLERRM;
END $$;

-- 4. Los métodos automáticos siguen sin poder registrarse a mano.
DO $$
BEGIN
  PERFORM public.registrar_cobro('d7d7d7d7-0000-4000-8000-000000000001', NULL,
            DATE '2026-11-06', 5, 'web');
  RAISE WARNING 'MAL   4. se ha registrado a mano un cobro web';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  4. un cobro «web» sigue sin poder registrarse a mano';
END $$;

-- 5. Lo pendiente cuenta el Bizum.
SELECT CASE WHEN (SELECT sum(importe) FROM public.cobros
                   WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000001') = 20
            THEN 'BIEN  5. el pedido tiene 20 € cobrados (quedan 30)'
            ELSE 'MAL   5. cobrado = ' || (SELECT COALESCE(sum(importe), 0) FROM public.cobros
                   WHERE pedido_id = 'd7d7d7d7-0000-4000-8000-000000000001') END;

ROLLBACK;
