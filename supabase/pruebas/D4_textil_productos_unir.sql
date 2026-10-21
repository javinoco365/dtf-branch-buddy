-- ============================================================================
-- Unir productos textiles que son el mismo modelo
-- ============================================================================
-- Prueba 20261101100000_textil_productos_unir.sql: las tallas de Roly, que
-- hoy son un producto cada una, quedan en un solo producto con la referencia
-- de cada una en su SKU, sin perder nada; y lo que no se debe unir no se une.
--
-- La migración se aplica dos veces (tiene que poder repetirse). Todo va
-- dentro de una transacción que se deshace al final.
BEGIN;

\ir ../migrations/20261101100000_textil_productos_unir.sql
\ir ../migrations/20261101100000_textil_productos_unir.sql

-- ---------------------------------------------------------------------------
-- Usuarios: ED editor, VI visor, NADIE sin nivel.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('d4000000-0000-4000-8000-0000000000ed', 'ed@d4.test'),
  ('d4000000-0000-4000-8000-0000000000f1', 'vi@d4.test'),
  ('d4000000-0000-4000-8000-0000000000aa', 'nadie@d4.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d4000000-0000-4000-8000-0000000000ed', 'editor'),
  ('d4000000-0000-4000-8000-0000000000f1', 'visor');

CREATE FUNCTION pg_temp.ed() RETURNS UUID LANGUAGE sql AS $$
  SELECT 'd4000000-0000-4000-8000-0000000000ed'::UUID
$$;
CREATE FUNCTION pg_temp.empresa() RETURNS UUID LANGUAGE sql AS $$
  SELECT id FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1
$$;

-- Ejecuta _sql y devuelve el texto que salga, o «error» y el SQLSTATE y el mensaje.
CREATE FUNCTION pg_temp.intento(_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r TEXT;
BEGIN
  EXECUTE _sql INTO r;
  RETURN COALESCE(r, 'ok');
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE || ' ' || SQLERRM;
END $$;

-- Un producto con una variante (la talla y el color van en la referencia,
-- como en Roly). Devuelve el id del producto.
CREATE FUNCTION pg_temp.producto(_id TEXT, _marca TEXT, _referencia TEXT, _nombre TEXT,
                                 _color TEXT, _talla TEXT, _sku TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID := ('d4000000-0000-4000-8000-' || lpad(_id, 12, '0'))::UUID;
BEGIN
  INSERT INTO public.textil_productos (id, empresa_id, marca, referencia, nombre)
  VALUES (v, pg_temp.empresa(), _marca, _referencia, _nombre);
  INSERT INTO public.textil_stock (empresa_id, producto_id, nombre, color, talla, sku)
  VALUES (pg_temp.empresa(), v, _nombre, _color, _talla, _sku);
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.unir(_quien UUID, _destino UUID, _origenes UUID[]) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT pg_temp.intento(format(
    'SELECT public.textil_productos_unir(%L::uuid, %L::uuid, %L::uuid[])::text',
    _quien, _destino, _origenes))
$$;

-- Antartida en tres productos: Blanco perla S y M, Royal S (esta con SKU propio).
SELECT pg_temp.producto('a1', 'Roly', 'SS643201011', 'Antartida', 'BLANCO PERLA', 'S'),
       pg_temp.producto('a2', 'Roly', 'SS643202011', 'Antartida', 'BLANCO PERLA', 'M'),
       pg_temp.producto('a3', 'ROLY', 'SS64320105', 'antartida', 'ROYAL', 'S', 'PROPIO');
-- Clasica en dos productos con la misma talla y color: no se pueden unir así.
SELECT pg_temp.producto('c1', 'Roly', 'SU10700201', 'Clasica', 'BLANCO', 'M'),
       pg_temp.producto('c2', 'Roly', 'SU10700299', 'Clasica', 'Blanco', 'm');
-- Otro nombre.
SELECT pg_temp.producto('d1', 'Roly', 'CA65020201', 'Dogo Premium', 'BLANCO', 'M');
-- Heavy: uno sin referencia y otro con ella.
SELECT pg_temp.producto('b0', 'Roly', NULL, 'Heavy', 'NEGRO', 'L'),
       pg_temp.producto('b1', 'Roly', 'H-1', 'Heavy', 'NEGRO', 'XL');

CREATE FUNCTION pg_temp.p(_id TEXT) RETURNS UUID LANGUAGE sql AS $$
  SELECT ('d4000000-0000-4000-8000-' || lpad(_id, 12, '0'))::UUID
$$;

-- 1-2. Sin nivel de escritura no se une nada.
SELECT CASE WHEN r LIKE 'error 42501%' THEN 'BIEN  1. un visor no une productos'
            ELSE 'MAL   1. el visor ha unido: ' || r END
  FROM (SELECT pg_temp.unir('d4000000-0000-4000-8000-0000000000f1'::uuid,
                            pg_temp.p('a1'), ARRAY[pg_temp.p('a2')]) AS r) x;
SELECT CASE WHEN r LIKE 'error 42501%' THEN 'BIEN  2. quien no tiene nivel tampoco'
            ELSE 'MAL   2. sin nivel ha unido: ' || r END
  FROM (SELECT pg_temp.unir('d4000000-0000-4000-8000-0000000000aa'::uuid,
                            pg_temp.p('a1'), ARRAY[pg_temp.p('a2')]) AS r) x;
SELECT CASE WHEN count(*) = 3 THEN 'BIEN  2b. y las tres Antartida siguen en tres productos'
            ELSE 'MAL   2b. productos con Antartida: ' || count(*) END
  FROM (SELECT DISTINCT producto_id FROM public.textil_stock
         WHERE producto_id IN (pg_temp.p('a1'), pg_temp.p('a2'), pg_temp.p('a3'))) x;

-- 3. Un editor une la Antartida (la marca y el nombre se comparan sin
--    mayúsculas: «ROLY» y «antartida» son los mismos).
SELECT CASE WHEN r = '{"productos": 2, "variantes": 2}' THEN 'BIEN  3. el editor une dos productos y sus dos variantes'
            ELSE 'MAL   3. la unión devolvió: ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('a1'),
                            ARRAY[pg_temp.p('a2'), pg_temp.p('a3')]) AS r) x;

-- 4. Las tres tallas, en el producto que se queda.
SELECT CASE WHEN count(*) = 3 THEN 'BIEN  4. las tres variantes están en el producto que se queda'
            ELSE 'MAL   4. variantes en el destino: ' || count(*) END
  FROM public.textil_stock WHERE producto_id = pg_temp.p('a1');

-- 5. La referencia de cada producto, en el SKU de su variante; un SKU propio se respeta.
SELECT CASE WHEN string_agg(talla || ':' || sku, ' ' ORDER BY color, talla)
                  = 'M:SS643202011 S:SS643201011 S:PROPIO'
            THEN 'BIEN  5. cada referencia pasa al SKU de su talla y el SKU propio se queda'
            ELSE 'MAL   5. SKU: ' || string_agg(talla || ':' || COALESCE(sku, '∅'), ' ' ORDER BY color, talla) END
  FROM public.textil_stock WHERE producto_id = pg_temp.p('a1');

-- 6. El que se queda pierde la referencia (era de una talla); los otros se
--    desactivan, no se borran, y conservan la suya.
SELECT CASE WHEN referencia IS NULL AND activo THEN 'BIEN  6a. el producto que se queda, activo y sin referencia'
            ELSE 'MAL   6a. referencia ' || COALESCE(referencia, '∅') || ', activo ' || activo END
  FROM public.textil_productos WHERE id = pg_temp.p('a1');
SELECT CASE WHEN count(*) = 2 AND bool_and(NOT activo) AND bool_and(referencia IS NOT NULL)
            THEN 'BIEN  6b. los otros dos siguen ahí, desactivados y con su referencia'
            ELSE 'MAL   6b. los de origen: ' || count(*) || ' filas' END
  FROM public.textil_productos WHERE id IN (pg_temp.p('a2'), pg_temp.p('a3'));

-- 7. La auditoría dice quién lo hizo.
SELECT CASE WHEN count(*) >= 3 AND bool_and(usuario_id = pg_temp.ed())
            THEN 'BIEN  7. la auditoría apunta al editor en cada variante movida'
            ELSE 'MAL   7. auditoría: ' || count(*) || ' filas, autores ' || string_agg(COALESCE(usuario_id::text, '∅'), ',') END
  FROM public.auditoria
 WHERE tabla = 'textil_stock' AND operacion = 'UPDATE'
   AND datos_despues ->> 'producto_id' = pg_temp.p('a1')::text;

-- 8. Dos variantes iguales (Blanco M en los dos) no se unen, y no se mueve nada.
SELECT CASE WHEN r ILIKE 'error 23505 %blanco · m %' THEN 'BIEN  8a. con la misma talla y color en los dos, no se une y dice cuál'
            ELSE 'MAL   8a. ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('c1'), ARRAY[pg_temp.p('c2')]) AS r) x;
SELECT CASE WHEN count(*) = 1 THEN 'BIEN  8b. y cada una sigue en su producto'
            ELSE 'MAL   8b. variantes en c1: ' || count(*) END
  FROM public.textil_stock WHERE producto_id = pg_temp.p('c1');

-- 9. Otro nombre no se une.
SELECT CASE WHEN r LIKE 'error 22023 %misma marca y el mismo nombre%' THEN 'BIEN  9. productos con otro nombre no se unen'
            ELSE 'MAL   9. ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('a1'), ARRAY[pg_temp.p('d1')]) AS r) x;

-- 10. Un producto consigo mismo, tampoco.
SELECT CASE WHEN r LIKE 'error 22023 %consigo mismo%' THEN 'BIEN  10. un producto no se une consigo mismo'
            ELSE 'MAL   10. ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('d1'), ARRAY[pg_temp.p('d1')]) AS r) x;

-- 11. Si uno no tiene referencia, ese es el que se queda.
SELECT CASE WHEN r LIKE 'error 22023 %sin referencia%' THEN 'BIEN  11a. con uno sin referencia, no se queda el otro'
            ELSE 'MAL   11a. ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('b1'), ARRAY[pg_temp.p('b0')]) AS r) x;
SELECT CASE WHEN r = '{"productos": 1, "variantes": 1}' THEN 'BIEN  11b. quedándose el que no tiene referencia, se une'
            ELSE 'MAL   11b. ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('b0'), ARRAY[pg_temp.p('b1')]) AS r) x;
SELECT CASE WHEN string_agg(talla || ':' || COALESCE(sku, '∅'), ' ' ORDER BY talla) = 'L:∅ XL:H-1'
            THEN 'BIEN  11c. la variante que llega lleva su referencia de SKU; la que ya estaba, igual'
            ELSE 'MAL   11c. ' || string_agg(talla || ':' || COALESCE(sku, '∅'), ' ' ORDER BY talla) END
  FROM public.textil_stock WHERE producto_id = pg_temp.p('b0');

-- 12. Un producto desactivado no puede ser el que se queda.
SELECT CASE WHEN r LIKE 'error 23001 %activo%' THEN 'BIEN  12. un producto desactivado no es destino'
            ELSE 'MAL   12. ' || r END
  FROM (SELECT pg_temp.unir(pg_temp.ed(), pg_temp.p('a2'), ARRAY[pg_temp.p('d1')]) AS r) x;

-- 13. Solo el servidor la llama.
SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.textil_productos_unir(uuid, uuid, uuid[])', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.textil_productos_unir(uuid, uuid, uuid[])', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.textil_productos_unir(uuid, uuid, uuid[])', 'EXECUTE')
            THEN 'BIEN  13. ni el navegador ni anon la ejecutan; el servidor, sí'
            ELSE 'MAL   13. permisos de ejecución mal puestos' END;

ROLLBACK;
