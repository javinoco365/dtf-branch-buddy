-- ============================================================================
-- Borrar tiendas: se puede, salvo cuando hay facturas emitidas colgando
-- ============================================================================

DO $$
DECLARE v_a UUID; v_b UUID; v_ped UUID;
BEGIN
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda sin historia', 'sin-historia')
    RETURNING id INTO v_a;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda con facturas', 'con-facturas')
    RETURNING id INTO v_b;

  INSERT INTO public.pedidos (tienda_id, numero, total)
  VALUES (v_a, 'P-BORR-1', 100), (v_a, 'P-BORR-2', 50);
  INSERT INTO public.clientes (tienda_id, nombre) VALUES (v_a, 'Cliente de paso');

  INSERT INTO public.pedidos (tienda_id, numero, total)
  VALUES (v_b, 'P-BORR-3', 200) RETURNING id INTO v_ped;
  PERFORM public.emitir_factura(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _tienda_id  => v_b,
    _receptor   => '{"nombre":"Cliente de la tienda B"}'::jsonb,
    _lineas     => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":200,"iva_rate":21}]'::jsonb,
    _pedido_id  => v_ped);

  PERFORM set_config('prueba.tienda_a', v_a::TEXT, false);
  PERFORM set_config('prueba.tienda_b', v_b::TEXT, false);
END $$;

-- 1. El resumen dice con números lo que se va a llevar por delante.
SELECT CASE WHEN (r ->> 'pedidos')::INT = 2 AND (r ->> 'clientes')::INT = 1
                 AND (r ->> 'facturas_emitidas')::INT = 0
            THEN 'BIEN  1. el resumen cuenta 2 pedidos, 1 cliente y 0 facturas'
            ELSE 'MAL   1. resumen ' || r::TEXT END
FROM public.tienda_resumen_borrado(current_setting('prueba.tienda_a')::UUID) AS r;

-- 2. Una tienda sin facturas emitidas se borra, y se lleva lo suyo.
DELETE FROM public.tiendas WHERE id = current_setting('prueba.tienda_a')::UUID;

SELECT CASE WHEN (SELECT count(*) FROM public.pedidos
                   WHERE tienda_id = current_setting('prueba.tienda_a')::UUID) = 0
            THEN 'BIEN  2. borrar la tienda se lleva sus pedidos en cascada'
            ELSE 'MAL   2. quedaron pedidos huerfanos' END;

-- 3. Una tienda con facturas emitidas NO se borra. Es la prueba que importa:
--    borrarla dejaría la factura sin saber de qué web salió.
DO $$
BEGIN
  DELETE FROM public.tiendas WHERE id = current_setting('prueba.tienda_b')::UUID;
  RAISE NOTICE 'MAL   3. dejo borrar una tienda con facturas emitidas';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. no deja borrar una tienda con facturas emitidas';
END $$;

-- 4. Y el resumen lo avisa antes de que lo intente.
SELECT CASE WHEN (r ->> 'facturas_emitidas')::INT = 1
            THEN 'BIEN  4. el resumen avisa de la factura emitida antes de intentarlo'
            ELSE 'MAL   4. resumen ' || r::TEXT END
FROM public.tienda_resumen_borrado(current_setting('prueba.tienda_b')::UUID) AS r;

-- 5. La salida es desactivarla: sigue ahí, fuera del día a día.
UPDATE public.tiendas SET activa = false
 WHERE id = current_setting('prueba.tienda_b')::UUID;

SELECT CASE WHEN NOT activa
            THEN 'BIEN  5. se desactiva, y la factura conserva su tienda'
            ELSE 'MAL   5. sigue activa' END
FROM public.tiendas WHERE id = current_setting('prueba.tienda_b')::UUID;

-- 6. La factura sigue apuntando a su tienda.
SELECT CASE WHEN count(*) = 1
            THEN 'BIEN  6. la factura emitida sigue sabiendo de que tienda salio'
            ELSE 'MAL   6. la factura perdio su tienda' END
FROM public.facturas WHERE tienda_id = current_setting('prueba.tienda_b')::UUID;
