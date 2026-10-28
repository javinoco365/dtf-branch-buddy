-- ============================================================================
-- Primer pedido de un cliente
-- ============================================================================
-- Prueba 20261103100000_primer_pedido.sql. Se aplica dos veces (tiene que
-- poder repetirse) y todo va en una transacción que se deshace al final.
--
-- Pedidos de la prueba (fecha, de más antiguo a más nuevo):
--   P1  tienda   1-oct  Ana López      ana@correo.es    600 111 222
--   P2  tienda   2-oct  ANA  LÓPEZ     Ana@Correo.ES                 → email: repite
--   P3  tienda   3-oct  Pedro Ruiz                      +34 600 333 444
--   P4  tienda   4-oct  Pedro Ruiz                      600333444     → teléfono: repite
--   P5  tienda   5-oct  Juan García    juan1@correo.es
--   P6  tienda   6-oct  juan garcia    juan2@correo.es               → solo nombre: dudoso
--   P7  tienda   7-oct  Juan García    juan3@correo.es  calle Mayor 1, 21450
--   P8  tienda   8-oct  Juan García    juan4@correo.es  Calle  Mayor 1, 21450 → nombre + dirección
--   P9  tienda   9-oct  Marta Sanz     marta@correo.es  (cancelado)
--   P10 tienda  10-oct  Marta Sanz     marta@correo.es  → el anterior está cancelado: primero
--   T1  textil  11-oct  Ana López (ficha F1 con ana@correo.es)        → ficha/email: repite
--   P11 tienda  12-oct  (sin nombre, email ni teléfono)               → sin datos
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261103100000_primer_pedido.sql
\ir ../migrations/20261103100000_primer_pedido.sql
RESET client_min_messages;

-- ---------------------------------------------------------------------------
-- 1. La forma: columnas con su CHECK, vista con security_invoker, funciones
-- ---------------------------------------------------------------------------
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND column_name = 'primer_pedido_decision'
                     AND table_name IN ('pedidos', 'textil_pedidos')) = 2
             AND (SELECT count(*) FROM pg_constraint
                   WHERE conname IN ('pedidos_primer_pedido_decision_valida',
                                     'textil_pedidos_primer_pedido_decision_valida')) = 2
             AND (SELECT array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)'
                    FROM pg_class WHERE oid = 'public.pedidos_huella_cliente'::regclass)
             AND NOT has_table_privilege('anon', 'public.pedidos_huella_cliente', 'SELECT')
             AND NOT has_function_privilege('anon', 'public.primer_pedido_resumen(uuid[], uuid[])', 'EXECUTE')
             AND NOT (SELECT prosecdef FROM pg_proc
                       WHERE oid = 'public.primer_pedido_resumen(uuid[], uuid[])'::regprocedure)
            THEN 'BIEN  1. columnas con CHECK, vista security_invoker, funciones INVOKER y sin anon'
            ELSE 'MAL   1. falta algo en la forma de la migración' END;

-- ---------------------------------------------------------------------------
-- 2. Cómo se igualan los datos
-- ---------------------------------------------------------------------------
SELECT CASE WHEN public.cliente_norm_texto('  ANA   López ') = 'ana lopez'
             AND public.cliente_norm_email(' Ana@Correo.ES ') = 'ana@correo.es'
             AND public.cliente_norm_telefono('+34 600 11 12 22') = '600111222'
             AND public.cliente_norm_telefono('0034600111222') = '600111222'
             AND public.cliente_norm_telefono('600-111-222') = '600111222'
             AND public.cliente_norm_telefono(NULL) = ''
             AND public.cliente_norm_texto(NULL) = ''
            THEN 'BIEN  2. nombre, email y teléfono se igualan (mayúsculas, tildes, espacios, +34)'
            ELSE 'MAL   2. la igualación no es la esperada' END;

-- ---------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------
INSERT INTO public.tiendas (id, nombre, slug)
VALUES ('d5d5d5d5-0000-4000-8000-0000000000a1', 'Tienda primer pedido', 'tienda-primer-pedido');

INSERT INTO public.clientes (id, nombre, email, origen)
VALUES ('d5d5d5d5-0000-4000-8000-0000000000f1', 'Ana López', 'ana@correo.es', 'textil');

INSERT INTO public.pedidos (id, tienda_id, numero, estado, total, origen, fecha_pedido,
                            cliente_nombre, cliente_email, cliente_telefono, direccion_facturacion)
VALUES
  ('d5d5d5d5-0000-4000-8000-000000000001', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-1',
   'entregado', 10, 'manual', '2026-10-01 10:00+02', 'Ana López', 'ana@correo.es', '600 111 222', NULL),
  ('d5d5d5d5-0000-4000-8000-000000000002', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-2',
   'entregado', 10, 'manual', '2026-10-02 10:00+02', 'ANA  LÓPEZ', 'Ana@Correo.ES', NULL, NULL),
  ('d5d5d5d5-0000-4000-8000-000000000003', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-3',
   'entregado', 10, 'manual', '2026-10-03 10:00+02', 'Pedro Ruiz', NULL, '+34 600 333 444', NULL),
  ('d5d5d5d5-0000-4000-8000-000000000004', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-4',
   'entregado', 10, 'manual', '2026-10-04 10:00+02', 'Pedro Ruiz', NULL, '600333444', NULL),
  ('d5d5d5d5-0000-4000-8000-000000000005', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-5',
   'entregado', 10, 'manual', '2026-10-05 10:00+02', 'Juan García', 'juan1@correo.es', NULL, NULL),
  ('d5d5d5d5-0000-4000-8000-000000000006', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-6',
   'entregado', 10, 'manual', '2026-10-06 10:00+02', 'juan garcia', 'juan2@correo.es', NULL, NULL),
  ('d5d5d5d5-0000-4000-8000-000000000007', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-7',
   'entregado', 10, 'manual', '2026-10-07 10:00+02', 'Juan García', 'juan3@correo.es', NULL,
   '{"direccion": "calle Mayor 1", "codigo_postal": "21450"}'),
  ('d5d5d5d5-0000-4000-8000-000000000008', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-8',
   'entregado', 10, 'manual', '2026-10-08 10:00+02', 'Juan García', 'juan4@correo.es', NULL,
   '{"direccion": "Calle  Mayor 1", "codigo_postal": "21450"}'),
  ('d5d5d5d5-0000-4000-8000-000000000009', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-9',
   'cancelado', 10, 'manual', '2026-10-09 10:00+02', 'Marta Sanz', 'marta@correo.es', NULL, NULL),
  ('d5d5d5d5-0000-4000-8000-000000000010', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-10',
   'entregado', 10, 'manual', '2026-10-10 10:00+02', 'Marta Sanz', 'marta@correo.es', NULL, NULL),
  ('d5d5d5d5-0000-4000-8000-000000000011', 'd5d5d5d5-0000-4000-8000-0000000000a1', 'D5-11',
   'entregado', 10, 'manual', '2026-10-12 10:00+02', NULL, NULL, NULL, NULL);

INSERT INTO public.textil_pedidos (id, numero, estado, cliente_id, cliente_nombre, total, fecha)
VALUES ('d5d5d5d5-0000-4000-8000-0000000000b1', 'D5-T1', 'pendiente',
        'd5d5d5d5-0000-4000-8000-0000000000f1', 'Ana López', 10, '2026-10-11');

CREATE TEMP TABLE r AS
SELECT * FROM public.primer_pedido_resumen(
  ARRAY(SELECT ('d5d5d5d5-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
          FROM generate_series(1, 11) n),
  ARRAY['d5d5d5d5-0000-4000-8000-0000000000b1'::uuid]);

CREATE FUNCTION pg_temp.p(_n INT) RETURNS UUID LANGUAGE sql AS $$
  SELECT ('d5d5d5d5-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$$;

-- ---------------------------------------------------------------------------
-- 3. El primero de cada uno no tiene coincidencias anteriores
-- ---------------------------------------------------------------------------
SELECT CASE WHEN (SELECT bool_and(fuertes = 0 AND solo_nombre = 0 AND tiene_datos AND NOT cancelado)
                    FROM r WHERE id IN (pg_temp.p(1), pg_temp.p(3), pg_temp.p(5)))
            THEN 'BIEN  3. el primer pedido de Ana, Pedro y Juan sale sin coincidencias'
            ELSE 'MAL   3. un primer pedido tenía coincidencias anteriores' END;

-- 4. Email igual escrito de otra forma: repite
SELECT CASE WHEN fuertes >= 1 THEN 'BIEN  4. mismo email con mayúsculas y espacios: repite'
            ELSE 'MAL   4. no vio el email repetido' END
  FROM r WHERE id = pg_temp.p(2);

-- 5. Teléfono con +34 y sin espacios: repite
SELECT CASE WHEN fuertes >= 1 THEN 'BIEN  5. mismo teléfono con +34 y sin espacios: repite'
            ELSE 'MAL   5. no vio el teléfono repetido' END
  FROM r WHERE id = pg_temp.p(4);

-- 6. Solo el nombre (sin tildes ni mayúsculas): dudoso, no repite
SELECT CASE WHEN fuertes = 0 AND solo_nombre = 1
            THEN 'BIEN  6. solo coincide el nombre: no cuenta como repetido, queda dudoso'
            ELSE 'MAL   6. el nombre solo se trató como coincidencia fuerte o no se vio' END
  FROM r WHERE id = pg_temp.p(6);

-- 7. Nombre y la misma dirección: repite (y los otros Juan, solo de nombre)
SELECT CASE WHEN fuertes = 1 AND solo_nombre = 2
            THEN 'BIEN  7. nombre + misma dirección: repite; los otros Juan quedan como solo nombre'
            ELSE 'MAL   7. nombre + dirección no se confirmó bien' END
  FROM r WHERE id = pg_temp.p(8);

-- 8. Un anterior cancelado no cuenta
SELECT CASE WHEN fuertes = 0 AND solo_nombre = 0
            THEN 'BIEN  8. el pedido anterior cancelado no cuenta'
            ELSE 'MAL   8. contó un pedido cancelado' END
  FROM r WHERE id = pg_temp.p(10);
SELECT CASE WHEN cancelado THEN 'BIEN  9. el pedido cancelado se marca como cancelado'
            ELSE 'MAL   9. el cancelado no sale como cancelado' END
  FROM r WHERE id = pg_temp.p(9);

-- 10. Textil con ficha: cruza con los pedidos de tienda por el email de la ficha
SELECT CASE WHEN fuertes >= 2 THEN 'BIEN  10. el textil cruza con las tiendas por la ficha y su email'
            ELSE 'MAL   10. el textil no vio los pedidos de tienda de Ana' END
  FROM r WHERE id = 'd5d5d5d5-0000-4000-8000-0000000000b1';

-- 11. Sin ningún dato: no se puede saber
SELECT CASE WHEN NOT tiene_datos AND fuertes = 0
            THEN 'BIEN  11. un pedido sin nombre, email ni teléfono no tiene con qué comparar'
            ELSE 'MAL   11. un pedido sin datos coincidió con algo' END
  FROM r WHERE id = pg_temp.p(11);

-- 12. Los parecidos de P6: el de Juan del 5-oct, por nombre, y no fuerte
SELECT CASE WHEN (SELECT count(*) FROM public.primer_pedido_parecidos('tienda', pg_temp.p(6))) = 1
             AND (SELECT motivos = ARRAY['nombre'] AND NOT fuerte AND numero = 'D5-5'
                    FROM public.primer_pedido_parecidos('tienda', pg_temp.p(6)))
            THEN 'BIEN  12. parecidos de un dudoso: el pedido anterior con el mismo nombre'
            ELSE 'MAL   12. los parecidos no son los esperados' END;

-- 13. Los parecidos de P8 dicen el motivo: nombre y dirección, fuerte
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.primer_pedido_parecidos('tienda', pg_temp.p(8))
                          WHERE numero = 'D5-7' AND motivos @> ARRAY['nombre', 'direccion'] AND fuerte)
            THEN 'BIEN  13. parecidos con su motivo: nombre y dirección, fuerte'
            ELSE 'MAL   13. no dio el motivo de la coincidencia' END;

-- 14. La decisión se guarda y solo admite nuevo o repite
UPDATE public.pedidos SET primer_pedido_decision = 'nuevo' WHERE id = pg_temp.p(6);
SELECT CASE WHEN decision = 'nuevo' THEN 'BIEN  14a. la decisión guardada sale en el resumen'
            ELSE 'MAL   14a. la decisión no sale en el resumen' END
  FROM public.primer_pedido_resumen(ARRAY[pg_temp.p(6)], '{}');
DO $$
BEGIN
  UPDATE public.pedidos SET primer_pedido_decision = 'quizas'
   WHERE id = 'd5d5d5d5-0000-4000-8000-000000000006';
  RAISE NOTICE 'MAL   14b. admitió una decisión que no es nuevo ni repite';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN  14b. solo admite nuevo o repite';
END $$;

ROLLBACK;
