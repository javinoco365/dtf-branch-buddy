-- ============================================================================
-- Presupuestos de las tiendas y productos genéricos
-- ============================================================================
-- El prefijo de la tienda se rellena al aplicar la migración, así que se crea
-- una tienda a la antigua y se vuelve a aplicar: prueba el relleno y que se
-- puede aplicar dos veces.

INSERT INTO auth.users (id, email) VALUES
  ('b1b1b1b1-0000-4000-8000-0000000000e1', 'solo-tienda-a@example.com');

DO $$ BEGIN
  INSERT INTO public.tiendas (id, nombre, slug) VALUES
    ('b1b1b1b1-0000-4000-8000-0000000000a1', 'DTF Culture', 'dtf-culture'),
    ('b1b1b1b1-0000-4000-8000-0000000000a2', '¡¡!!', NULL),
    ('b1b1b1b1-0000-4000-8000-0000000000a3', 'Otra tienda', 'otra');
  -- Como si la columna no existiera todavía.
  UPDATE public.tiendas SET prefijo = NULL
   WHERE id IN ('b1b1b1b1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-0000000000a2');
  INSERT INTO public.tienda_usuarios (tienda_id, user_id)
  VALUES ('b1b1b1b1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-0000000000e1');
END $$;

\ir ../migrations/20261001100000_presupuestos_tiendas.sql

-- 1. El prefijo sale del slug o del nombre.
SELECT CASE WHEN count(*) FILTER (WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000a1' AND prefijo = 'DTFC') = 1
             AND count(*) FILTER (WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000a2' AND prefijo = 'TDA') = 1
            THEN 'BIEN  1. el prefijo sale del slug, o TDA si no queda nada'
            ELSE 'MAL   1. prefijos: ' || string_agg(COALESCE(prefijo, 'NULL'), ', ') END
FROM public.tiendas
WHERE id IN ('b1b1b1b1-0000-4000-8000-0000000000a1', 'b1b1b1b1-0000-4000-8000-0000000000a2');

-- 2. Un prefijo con minúsculas o símbolos se rechaza.
DO $$ BEGIN
  UPDATE public.tiendas SET prefijo = 'dt-f' WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000a1';
  RAISE WARNING 'MAL   2. se ha aceptado un prefijo no valido';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN  2. prefijo no valido: rechazado';
END $$;

-- 3. Un producto sin tienda es genérico; con woo_product_id, no se admite.
DO $$ BEGIN
  INSERT INTO public.productos (id, tienda_id, nombre, unidad, precio_unitario)
  VALUES ('b1b1b1b1-0000-4000-8000-0000000000f1', NULL, 'Metro DTF genérico', 'm', 12);
  INSERT INTO public.productos (id, tienda_id, nombre, unidad, precio_unitario)
  VALUES ('b1b1b1b1-0000-4000-8000-0000000000f2', 'b1b1b1b1-0000-4000-8000-0000000000a3',
          'Solo de otra tienda', 'ud', 5);
  RAISE NOTICE 'BIEN  3. se crea un producto generico, sin tienda';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   3. no se ha podido crear el generico: %', SQLERRM;
END $$;

DO $$ BEGIN
  INSERT INTO public.productos (tienda_id, nombre, woo_product_id) VALUES (NULL, 'Generico woo', 777);
  RAISE WARNING 'MAL  3b. un generico con woo_product_id aceptado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 3b. un generico no puede venir de WooCommerce';
END $$;

-- 4. Numeración por tienda: cada tienda lleva su propio contador.
DO $$
DECLARE v_empresa UUID; a1 INT; a2 INT; b1 INT;
BEGIN
  SELECT empresa_id INTO v_empresa FROM public.tiendas WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000a1';
  a1 := public.siguiente_numero(v_empresa, 'presupuesto:b1b1b1b1-0000-4000-8000-0000000000a1', 2026);
  a2 := public.siguiente_numero(v_empresa, 'presupuesto:b1b1b1b1-0000-4000-8000-0000000000a1', 2026);
  b1 := public.siguiente_numero(v_empresa, 'presupuesto:b1b1b1b1-0000-4000-8000-0000000000a3', 2026);
  IF a1 = 1 AND a2 = 2 AND b1 = 1 THEN
    RAISE NOTICE 'BIEN  4. cada tienda numera sus presupuestos por separado';
  ELSE
    RAISE WARNING 'MAL   4. numeros: % % %', a1, a2, b1;
  END IF;
END $$;

-- 5. Presupuestos en las dos tiendas, con sus líneas.
INSERT INTO public.presupuestos (id, tienda_id, numero, cliente_nombre, subtotal, iva, total)
VALUES
  ('b1b1b1b1-0000-4000-8000-000000000011', 'b1b1b1b1-0000-4000-8000-0000000000a1',
   'PRES-DTFC-2026-0001', 'Peña La Charanga', 100, 21, 121),
  ('b1b1b1b1-0000-4000-8000-000000000012', 'b1b1b1b1-0000-4000-8000-0000000000a3',
   'PRES-OTRA-2026-0001', 'Otro cliente', 10, 2.1, 12.1);
INSERT INTO public.presupuesto_items
  (presupuesto_id, producto_id, descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total)
VALUES
  ('b1b1b1b1-0000-4000-8000-000000000011', 'b1b1b1b1-0000-4000-8000-0000000000f1',
   'Metro DTF genérico', 5, 'm', 20, 21, 100, 21, 121),
  ('b1b1b1b1-0000-4000-8000-000000000012', NULL, 'Línea libre', 1, 'ud', 10, 21, 10, 2.1, 12.1);

-- 6. El mismo número dos veces en la misma tienda: rechazado.
DO $$ BEGIN
  INSERT INTO public.presupuestos (tienda_id, numero)
  VALUES ('b1b1b1b1-0000-4000-8000-0000000000a1', 'PRES-DTFC-2026-0001');
  RAISE WARNING 'MAL   6. numero repetido en la misma tienda aceptado';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'BIEN  6. el numero no se repite dentro de una tienda';
END $$;

-- 7. Borrar el producto no toca la línea: se queda con su descripción y precio.
DELETE FROM public.productos WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000f1';
SELECT CASE WHEN producto_id IS NULL AND descripcion = 'Metro DTF genérico' AND total = 121
            THEN 'BIEN  7. borrar el producto deja la linea congelada'
            ELSE 'MAL   7. la linea ha cambiado al borrar el producto' END
FROM public.presupuesto_items WHERE presupuesto_id = 'b1b1b1b1-0000-4000-8000-000000000011';

-- 8. RLS: quien solo es de la tienda A ve sus presupuestos, no los de otra.
INSERT INTO public.productos (id, tienda_id, nombre) VALUES
  ('b1b1b1b1-0000-4000-8000-0000000000f3', NULL, 'Otro genérico');
DO $$
DECLARE v_pres INT; v_items INT; v_prod_gen INT; v_prod_otra INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b1b1b1b1-0000-4000-8000-0000000000e1', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_pres FROM public.presupuestos
   WHERE id IN ('b1b1b1b1-0000-4000-8000-000000000011', 'b1b1b1b1-0000-4000-8000-000000000012');
  SELECT count(*) INTO v_items FROM public.presupuesto_items
   WHERE presupuesto_id IN ('b1b1b1b1-0000-4000-8000-000000000011', 'b1b1b1b1-0000-4000-8000-000000000012');
  SELECT count(*) INTO v_prod_gen FROM public.productos WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000f3';
  SELECT count(*) INTO v_prod_otra FROM public.productos WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000f2';
  RESET ROLE;
  IF v_pres = 1 AND v_items = 1 THEN
    RAISE NOTICE 'BIEN  8. solo ve los presupuestos (y lineas) de su tienda';
  ELSE
    RAISE WARNING 'MAL   8. ve % presupuesto(s) y % linea(s)', v_pres, v_items;
  END IF;
  IF v_prod_gen = 1 AND v_prod_otra = 0 THEN
    RAISE NOTICE 'BIEN  9. ve los productos genericos pero no los de otra tienda';
  ELSE
    RAISE WARNING 'MAL   9. genericos % / de otra tienda %', v_prod_gen, v_prod_otra;
  END IF;
END $$;
RESET ROLE;

-- 10. Ni puede escribir un presupuesto en otra tienda.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b1b1b1b1-0000-4000-8000-0000000000e1', true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.presupuestos (tienda_id, numero)
  VALUES ('b1b1b1b1-0000-4000-8000-0000000000a3', 'PRES-INTRUSO');
  RAISE WARNING 'MAL  10. ha creado un presupuesto en una tienda ajena';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'BIEN 10. no crea presupuestos en tiendas ajenas';
END $$;
RESET ROLE;

-- 11. Borrar la tienda se lleva sus presupuestos y sus líneas.
DELETE FROM public.tiendas WHERE id = 'b1b1b1b1-0000-4000-8000-0000000000a3';
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.presupuestos WHERE id = 'b1b1b1b1-0000-4000-8000-000000000012')
             AND NOT EXISTS (SELECT 1 FROM public.presupuesto_items WHERE presupuesto_id = 'b1b1b1b1-0000-4000-8000-000000000012')
            THEN 'BIEN 11. borrar la tienda se lleva sus presupuestos'
            ELSE 'MAL  11. quedan presupuestos de una tienda borrada' END;

-- 12. Auditoría y ninguna política FOR ALL.
SELECT CASE WHEN count(*) >= 2
            THEN 'BIEN 12. la auditoria registra presupuestos y lineas'
            ELSE 'MAL  12. solo ' || count(*) || ' filas de auditoria' END
FROM public.auditoria WHERE tabla IN ('presupuestos', 'presupuesto_items');

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 13. ninguna politica FOR ALL en productos ni presupuestos'
            ELSE 'MAL  13. ' || count(*) || ' politica(s) FOR ALL' END
FROM pg_policies
WHERE tablename IN ('productos', 'presupuestos', 'presupuesto_items') AND cmd = 'ALL';
