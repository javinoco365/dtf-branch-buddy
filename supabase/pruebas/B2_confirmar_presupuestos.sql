-- ============================================================================
-- Confirmar presupuesto: el presupuesto aceptado se convierte en pedido
-- ============================================================================
-- Usa la tienda DTF Culture (prefijo DTFC) y el usuario de solo esa tienda
-- que dejó B1_presupuestos_tiendas.sql.

INSERT INTO public.tiendas (id, nombre, slug, prefijo)
VALUES ('b2b2b2b2-0000-4000-8000-0000000000a9', 'Tienda ajena', 'ajena', 'AJEN');

INSERT INTO public.presupuestos
  (id, tienda_id, numero, cliente_nombre, cliente_email, envio, subtotal, iva, total, notas, estado)
VALUES
  ('b2b2b2b2-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-0000000000a1',
   'PRES-DTFC-2026-0101', 'Peña La Charanga', 'pena@example.com', 8, 83, 17.43, 100.43,
   'Entregar en el local', 'enviado'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'b1b1b1b1-0000-4000-8000-0000000000a1',
   'PRES-DTFC-2026-0102', 'Rechazado', NULL, 0, 10, 2.1, 12.1, NULL, 'rechazado'),
  ('b2b2b2b2-0000-4000-8000-000000000003', 'b1b1b1b1-0000-4000-8000-0000000000a1',
   'PRES-DTFC-2026-0103', 'Sin lineas', NULL, 0, 0, 0, 0, NULL, 'borrador'),
  ('b2b2b2b2-0000-4000-8000-000000000009', 'b2b2b2b2-0000-4000-8000-0000000000a9',
   'PRES-AJEN-2026-0001', 'De otra tienda', NULL, 0, 10, 2.1, 12.1, NULL, 'enviado');

INSERT INTO public.presupuesto_items
  (presupuesto_id, orden, descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total)
VALUES
  ('b2b2b2b2-0000-4000-8000-000000000001', 0, 'Metro DTF 57 cm', 5, 'm', 12, 21, 60, 12.6, 72.6),
  ('b2b2b2b2-0000-4000-8000-000000000001', 1, 'Montaje', 1, 'ud', 15, 21, 15, 3.15, 18.15),
  ('b2b2b2b2-0000-4000-8000-000000000002', 0, 'Algo', 1, 'ud', 10, 21, 10, 2.1, 12.1),
  ('b2b2b2b2-0000-4000-8000-000000000009', 0, 'Algo', 1, 'ud', 10, 21, 10, 2.1, 12.1);

-- 1. Confirmar crea el pedido con los importes del presupuesto, céntimo a céntimo.
SELECT set_config('prueba.pedido',
  public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000001')::TEXT, false) \g /dev/null

SELECT CASE WHEN p.numero LIKE 'PED-DTFC-%-0001' AND p.total = 100.43 AND p.subtotal = 83
             AND p.iva = 17.43 AND p.envio = 8 AND p.metros_total = 5 AND p.origen = 'manual'
             AND p.estado = 'pendiente' AND p.cliente_nombre = 'Peña La Charanga'
             AND p.notas LIKE 'Del presupuesto PRES-DTFC-2026-0101%Entregar en el local'
            THEN 'BIEN  1. el pedido nace con los importes, el cliente y el numero PED-DTFC'
            ELSE 'MAL   1. pedido: ' || p.numero || ' total ' || p.total END
FROM public.pedidos p WHERE p.id = current_setting('prueba.pedido')::UUID;

-- 2. Las líneas, copiadas en orden y sin recalcular.
SELECT CASE WHEN count(*) = 2 AND sum(total) = 90.75
             AND bool_or(descripcion = 'Metro DTF 57 cm' AND unidad = 'm' AND iva = 12.6)
            THEN 'BIEN  2. las lineas pasan al pedido tal cual'
            ELSE 'MAL   2. lineas: ' || count(*) END
FROM public.pedido_items WHERE pedido_id = current_setting('prueba.pedido')::UUID;

-- 3. El presupuesto queda aceptado y enlazado.
SELECT CASE WHEN estado = 'aceptado' AND pedido_id = current_setting('prueba.pedido')::UUID
            THEN 'BIEN  3. el presupuesto queda aceptado y apunta a su pedido'
            ELSE 'MAL   3. presupuesto: ' || estado END
FROM public.presupuestos WHERE id = 'b2b2b2b2-0000-4000-8000-000000000001';

-- 4. Confirmar otra vez: rechazado, no crea un segundo pedido.
DO $$ BEGIN
  PERFORM public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000001');
  RAISE WARNING 'MAL   4. se ha confirmado dos veces';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  4. un presupuesto se confirma una sola vez';
END $$;

-- 5. Rechazado o sin líneas: no se confirman.
DO $$ BEGIN
  PERFORM public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000002');
  RAISE WARNING 'MAL  5a. se ha confirmado un rechazado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 5a. un presupuesto rechazado no se confirma';
END $$;
DO $$ BEGIN
  PERFORM public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000003');
  RAISE WARNING 'MAL  5b. se ha confirmado uno sin lineas';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 5b. un presupuesto sin lineas no se confirma';
END $$;

-- 6. Quien no es de la tienda no puede confirmar sus presupuestos.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b1b1b1b1-0000-4000-8000-0000000000e1', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000009');
  RAISE WARNING 'MAL   6. ha confirmado un presupuesto de una tienda ajena';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6. no confirma presupuestos de tiendas ajenas';
END $$;
RESET ROLE;

-- 7. El segundo pedido de la tienda lleva el siguiente número.
DELETE FROM public.presupuesto_items WHERE presupuesto_id = 'b2b2b2b2-0000-4000-8000-000000000003';
INSERT INTO public.presupuesto_items
  (presupuesto_id, orden, descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total)
VALUES ('b2b2b2b2-0000-4000-8000-000000000003', 0, 'Algo', 1, 'ud', 0, 21, 0, 0, 0);
-- Primero se confirma y se guarda el id: dentro de un WHERE la función se
-- evaluaría una vez por fila.
SELECT set_config('prueba.pedido2',
  public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000003')::TEXT, false) \g /dev/null
SELECT CASE WHEN p.numero LIKE 'PED-DTFC-%-0002'
            THEN 'BIEN  7. el siguiente pedido lleva el siguiente numero'
            ELSE 'MAL   7. numero: ' || p.numero END
FROM public.pedidos p
WHERE p.id = current_setting('prueba.pedido2')::UUID;

-- 8. Borrar el pedido deja el presupuesto libre para volver a confirmarlo.
DELETE FROM public.pedidos WHERE id = current_setting('prueba.pedido')::UUID;
SELECT CASE WHEN pedido_id IS NULL
            THEN 'BIEN  8. borrar el pedido suelta el presupuesto'
            ELSE 'MAL   8. el presupuesto sigue apuntando a un pedido borrado' END
FROM public.presupuestos WHERE id = 'b2b2b2b2-0000-4000-8000-000000000001';

-- 9. El enlace textil existe y un pedido textil sale de un solo presupuesto.
DO $$
DECLARE v_pedido UUID;
BEGIN
  INSERT INTO public.textil_pedidos (numero, estado, total) VALUES ('TPD-B2-1', 'pendiente', 10)
  RETURNING id INTO v_pedido;
  INSERT INTO public.textil_presupuestos (numero, cliente_nombre, pedido_id)
  VALUES ('PRES-B2-1', 'Uno', v_pedido);
  BEGIN
    INSERT INTO public.textil_presupuestos (numero, cliente_nombre, pedido_id)
    VALUES ('PRES-B2-2', 'Dos', v_pedido);
    RAISE WARNING 'MAL   9. dos presupuestos textil con el mismo pedido';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'BIEN  9. un pedido textil sale de un solo presupuesto';
  END;
END $$;

-- 10. anon no confirma.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.confirmar_presupuesto(uuid)', 'EXECUTE')
            THEN 'BIEN 10. anon no puede confirmar presupuestos'
            ELSE 'MAL  10. anon puede confirmar presupuestos' END;

-- 11. DTF UV (20261113100000): cada línea con su línea de producto; el pedido
--     lleva en metros_total solo el DTF y el UV aparte, con su base y su IVA.
INSERT INTO public.presupuestos
  (id, tienda_id, numero, cliente_nombre, envio, subtotal, iva, total, estado)
VALUES
  ('b2b2b2b2-0000-4000-8000-000000000011', 'b1b1b1b1-0000-4000-8000-0000000000a1',
   'PRES-DTFC-2026-0111', 'Mixto UV', 0, 63, 13.23, 76.23, 'enviado');
INSERT INTO public.presupuesto_items
  (presupuesto_id, orden, descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total, linea)
VALUES
  ('b2b2b2b2-0000-4000-8000-000000000011', 0, 'Metro DTF', 4, 'm', 7, 21, 28, 5.88, 33.88, 'dtf'),
  ('b2b2b2b2-0000-4000-8000-000000000011', 1, 'DTF UV por metros', 2, 'm', 17.5, 21, 35, 7.35, 42.35, 'uv');
SELECT set_config('prueba.pedido_uv',
  public.confirmar_presupuesto('b2b2b2b2-0000-4000-8000-000000000011')::TEXT, false) \g /dev/null
SELECT CASE WHEN p.metros_total = 4 AND p.metros_uv = 2 AND p.bruta_uv = 35 AND p.iva_uv = 7.35
            THEN 'BIEN 11. el pedido de un presupuesto mixto separa el DTF y el DTF UV'
            ELSE 'MAL  11. metros ' || p.metros_total || ' / uv ' || p.metros_uv
                 || ' / bruta_uv ' || p.bruta_uv || ' / iva_uv ' || p.iva_uv END
FROM public.pedidos p
WHERE p.id = current_setting('prueba.pedido_uv')::UUID;
SELECT CASE WHEN count(*) FILTER (WHERE linea = 'uv') = 1 AND count(*) = 2
            THEN 'BIEN 12. las lineas del pedido conservan su linea de producto'
            ELSE 'MAL  12. lineas uv: ' || count(*) FILTER (WHERE linea = 'uv') END
FROM public.pedido_items
WHERE pedido_id = current_setting('prueba.pedido_uv')::UUID;
