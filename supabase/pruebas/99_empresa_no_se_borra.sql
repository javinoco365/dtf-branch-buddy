-- ============================================================================
-- La sociedad no se borra, y no se lleva el libro por delante
-- ============================================================================

-- 1. Ninguna tabla cuelga ya de empresas en cascada.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  1. ninguna tabla se borra en cascada con la sociedad'
            ELSE 'MAL   1. en cascada: ' || string_agg(rel.relname, ', ') END
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_class ref ON ref.oid = con.confrelid
WHERE ref.relname = 'empresas' AND con.contype = 'f' AND con.confdeltype = 'c';

-- 2. Y todas las de negocio la restringen.
SELECT CASE WHEN count(*) >= 7
            THEN 'BIEN  2. ' || count(*) || ' tablas restringen el borrado de la sociedad'
            ELSE 'MAL   2. solo ' || count(*) END
FROM pg_constraint con
JOIN pg_class ref ON ref.oid = con.confrelid
WHERE ref.relname = 'empresas' AND con.contype = 'f' AND con.confdeltype = 'r';

-- 3. LA PRUEBA QUE IMPORTA: con un movimiento de stock, la sociedad no se borra.
--    Antes de esto, el borrado se habria llevado el libro entero.
DO $$
DECLARE v_empresa UUID; v_stock UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.textil_stock (nombre, cantidad, coste_unitario)
  VALUES ('Prueba borrado empresa', 0, 0) RETURNING id INTO v_stock;
  INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad)
  VALUES (v_empresa, v_stock, 'inicial', 10);
  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
  PERFORM set_config('prueba.stock', v_stock::TEXT, false);
END $$;

DO $$
BEGIN
  DELETE FROM public.empresas WHERE id = current_setting('prueba.empresa')::UUID;
  RAISE NOTICE 'MAL   3. borro la sociedad llevandose el libro de stock';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. no deja borrar la sociedad: el libro de stock la retiene';
END $$;

-- 4. Y el movimiento sigue ahi.
SELECT CASE WHEN count(*) = 1
            THEN 'BIEN  4. el movimiento sigue en el libro'
            ELSE 'MAL   4. el libro perdio el movimiento' END
FROM public.textil_stock_movimientos
WHERE stock_id = current_setting('prueba.stock')::UUID;

-- 5. La politica de empresas ya no es FOR ALL, y no hay ninguna de borrado.
SELECT CASE WHEN count(*) FILTER (WHERE cmd = 'ALL') = 0
             AND count(*) FILTER (WHERE cmd = 'DELETE') = 0
            THEN 'BIEN  5. empresas sin FOR ALL y sin politica de borrado'
            ELSE 'MAL   5. sigue habiendo una via de borrado' END
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas';
