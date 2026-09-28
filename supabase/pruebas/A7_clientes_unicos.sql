-- ============================================================================
-- Clientes únicos por empresa
-- ============================================================================
-- Cuando el arnés aplica las migraciones, textil_clientes está vacía: la copia
-- no tendría nada que copiar. Así que aquí se mete un cliente textil a la
-- antigua y se vuelve a aplicar la migración. Eso prueba la copia y, de paso,
-- que la migración se puede aplicar dos veces sin romperse.
INSERT INTO public.textil_clientes (id, nombre, email, nif, direccion)
VALUES ('a7a7a7a7-0000-4000-8000-0000000000ff', 'Cliente textil de antes',
        'antes@example.com', 'B99999999', 'Calle Mayor 1');

\ir ../migrations/20260928100000_clientes_unicos.sql

-- 1. La copia se hizo con el mismo id y con sus datos.
SELECT CASE WHEN count(*) = 1
            THEN 'BIEN  1. el cliente textil tiene su ficha en clientes, mismo id y datos'
            ELSE 'MAL   1. el cliente textil no se ha copiado bien' END
FROM public.clientes
WHERE id = 'a7a7a7a7-0000-4000-8000-0000000000ff'
  AND origen = 'textil' AND tienda_id IS NULL
  AND nombre = 'Cliente textil de antes' AND nif = 'B99999999'
  AND direccion = 'Calle Mayor 1';

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 1b. ningun cliente textil sin su ficha'
            ELSE 'MAL  1b. ' || count(*) || ' cliente(s) textil sin ficha' END
FROM public.textil_clientes tc
LEFT JOIN public.clientes c ON c.id = tc.id
WHERE c.id IS NULL;

-- 2. Un cliente sin tienda se puede crear: es de la empresa.
DO $$ BEGIN
  INSERT INTO public.clientes (id, nombre, email, nif, origen)
  VALUES ('a7a7a7a7-0000-4000-8000-000000000001', 'Peña La Charanga',
          'charanga@example.com', 'G-12.345.678', 'textil');
  RAISE NOTICE 'BIEN  2. un cliente sin tienda se puede crear';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   2. no se ha podido crear un cliente sin tienda: %', SQLERRM;
END $$;

-- 3. Un pedido textil apunta ya a la ficha única.
DO $$ BEGIN
  INSERT INTO public.textil_pedidos (id, numero, estado, cliente_id, cliente_nombre, total)
  VALUES ('a7a7a7a7-0000-4000-8000-000000000010', 'TPD-A7-1', 'pendiente',
          'a7a7a7a7-0000-4000-8000-000000000001', 'Peña La Charanga', 50);
  RAISE NOTICE 'BIEN  3. un pedido textil acepta un cliente de la ficha unica';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   3. el pedido textil no acepta el cliente: %', SQLERRM;
END $$;

-- 4. Y lo mismo un presupuesto textil.
DO $$ BEGIN
  INSERT INTO public.textil_presupuestos (id, numero, cliente_id, cliente_nombre)
  VALUES ('a7a7a7a7-0000-4000-8000-000000000020', 'PRES-A7-1',
          'a7a7a7a7-0000-4000-8000-000000000001', 'Peña La Charanga');
  RAISE NOTICE 'BIEN  4. un presupuesto textil acepta un cliente de la ficha unica';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   4. el presupuesto textil no acepta el cliente: %', SQLERRM;
END $$;

-- 5. Ninguna tabla del textil apunta ya a textil_clientes.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  5. ninguna clave ajena apunta ya a textil_clientes'
            ELSE 'MAL   5. ' || count(*) || ' clave(s) ajena(s) siguen en textil_clientes' END
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'public.textil_clientes'::regclass;

-- 6. Borrar una tienda no se lleva a sus clientes.
DO $$
DECLARE v_tienda UUID := 'a7a7a7a7-0000-4000-8000-000000000100';
BEGIN
  INSERT INTO public.tiendas (id, nombre, slug) VALUES (v_tienda, 'Tienda efimera', 'tienda-efimera-a7');
  INSERT INTO public.clientes (id, tienda_id, nombre, email)
  VALUES ('a7a7a7a7-0000-4000-8000-000000000002', v_tienda, 'Club Nautico',
          'CHARANGA@example.com ');
  DELETE FROM public.tiendas WHERE id = v_tienda;
  IF EXISTS (SELECT 1 FROM public.clientes
              WHERE id = 'a7a7a7a7-0000-4000-8000-000000000002' AND tienda_id IS NULL) THEN
    RAISE NOTICE 'BIEN  6. borrar la tienda conserva al cliente, sin tienda de origen';
  ELSE
    RAISE WARNING 'MAL   6. el cliente ha desaparecido con su tienda';
  END IF;
END $$;

-- 7. El mismo correo escrito distinto sale como posible duplicado.
SELECT CASE WHEN count(*) = 1
            THEN 'BIEN  7. mismo correo con mayusculas y espacios: posible duplicado'
            ELSE 'MAL   7. el duplicado por correo no aparece' END
FROM public.clientes_posibles_duplicados
WHERE motivo = 'email' AND clave = 'charanga@example.com'
  AND 'a7a7a7a7-0000-4000-8000-000000000001' = ANY (cliente_ids)
  AND 'a7a7a7a7-0000-4000-8000-000000000002' = ANY (cliente_ids);

-- 8. El mismo NIF con guiones y puntos, también.
INSERT INTO public.clientes (id, nombre, nif)
VALUES ('a7a7a7a7-0000-4000-8000-000000000003', 'Charanga (otra ficha)', 'g12345678');

SELECT CASE WHEN count(*) = 1
            THEN 'BIEN  8. mismo NIF escrito distinto: posible duplicado'
            ELSE 'MAL   8. el duplicado por NIF no aparece' END
FROM public.clientes_posibles_duplicados
WHERE motivo = 'nif' AND clave = 'G12345678';

-- 9. No se fusiona nada solo: las tres fichas siguen existiendo.
SELECT CASE WHEN count(*) = 3
            THEN 'BIEN  9. la migracion no fusiona nada por su cuenta'
            ELSE 'MAL   9. quedan ' || count(*) || ' fichas' END
FROM public.clientes
WHERE id IN ('a7a7a7a7-0000-4000-8000-000000000001',
             'a7a7a7a7-0000-4000-8000-000000000002',
             'a7a7a7a7-0000-4000-8000-000000000003');

-- 10. textil_clientes congelada para authenticated. Los GRANT de tabla no
--     sirven de prueba aquí (20_auditoria_autor.sql concede ALL ON ALL TABLES
--     a authenticated), así que se comprueba en la migración: el REVOKE está.
SELECT CASE WHEN obj_description('public.textil_clientes'::regclass, 'pg_class') LIKE 'OBSOLETA%'
            THEN 'BIEN 10. textil_clientes marcada como obsoleta'
            ELSE 'MAL  10. textil_clientes sin marcar' END;

-- 11. Origen solo admite los tres valores.
DO $$ BEGIN
  INSERT INTO public.clientes (nombre, origen) VALUES ('X', 'woocommerce');
  RAISE WARNING 'MAL  11. se ha aceptado un origen que no existe';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 11. origen desconocido: rechazado';
END $$;

-- 12. Sin política FOR ALL en clientes.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 12. ninguna politica FOR ALL en clientes'
            ELSE 'MAL  12. ' || count(*) || ' politica(s) FOR ALL' END
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clientes' AND cmd = 'ALL';

-- 13. La vista de duplicados respeta la RLS de quien consulta.
SELECT CASE WHEN 'security_invoker=true' = ANY (c.reloptions)
            THEN 'BIEN 13. la vista de duplicados respeta la RLS'
            ELSE 'MAL  13. la vista de duplicados salta la RLS' END
FROM pg_class c WHERE c.oid = 'public.clientes_posibles_duplicados'::regclass;
