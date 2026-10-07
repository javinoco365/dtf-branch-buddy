-- ============================================================================
-- Reponer factura_comprobar_fecha()
-- ============================================================================
-- Reproduce producción: la función no está (la migración que la creaba no se
-- aplicó) y la emisión de tickets la llama. La migración nueva la repone sin
-- tocar emitir_factura().

-- 1. Como en producción: sin la función.
DROP FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE);
SELECT CASE WHEN to_regprocedure('public.factura_comprobar_fecha(uuid,text,integer,date)') IS NULL
            THEN 'BIEN  1. sin la función, como en producción'
            ELSE 'MAL   1. la función sigue ahí' END;

-- 2. Se aplica la migración nueva (dos veces: tiene que poder repetirse).
\ir ../migrations/20261009100000_reponer_factura_comprobar_fecha.sql
\ir ../migrations/20261009100000_reponer_factura_comprobar_fecha.sql
SELECT CASE WHEN to_regprocedure('public.factura_comprobar_fecha(uuid,text,integer,date)') IS NOT NULL
            THEN 'BIEN  2. la función vuelve a existir'
            ELSE 'MAL   2. la función no se ha creado' END;

-- 3. emitir_factura() sigue siendo la de tickets: acepta _simplificada.
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
          WHERE p.proname = 'emitir_factura'
            AND pg_get_function_arguments(p.oid) LIKE '%_simplificada%')
            THEN 'BIEN  3. emitir_factura() sigue con tickets'
            ELSE 'MAL   3. emitir_factura() perdió los tickets' END;

-- 4. Hace su trabajo: hacia atrás no, el mismo día sí.
DO $$
DECLARE
  v_empresa UUID;
  v_serie TEXT;
  v_ejercicio INT;
  v_ultima DATE;
BEGIN
  SELECT empresa_id, serie, ejercicio, max(fecha)
    INTO v_empresa, v_serie, v_ejercicio, v_ultima
    FROM (SELECT empresa_id, serie, ejercicio, fecha FROM public.facturas
          UNION ALL
          SELECT empresa_id, serie, ejercicio, fecha FROM public.textil_facturas) f
   GROUP BY empresa_id, serie, ejercicio
   LIMIT 1;
  IF v_ultima IS NULL THEN
    RAISE NOTICE 'BIEN 4. (sin facturas en la base de pruebas: nada que comparar)';
    RETURN;
  END IF;
  PERFORM public.factura_comprobar_fecha(v_empresa, v_serie, v_ejercicio, v_ultima);
  BEGIN
    PERFORM public.factura_comprobar_fecha(v_empresa, v_serie, v_ejercicio, v_ultima - 1);
    RAISE WARNING 'MAL   4. dejó emitir con fecha anterior a la última';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'BIEN 4. mismo día sí, hacia atrás no';
  END;
END $$;

-- 5. Nadie la llama desde fuera: solo el servicio.
SELECT CASE WHEN NOT has_function_privilege('authenticated',
                 'public.factura_comprobar_fecha(uuid,text,integer,date)', 'EXECUTE')
            THEN 'BIEN  5. authenticated no puede llamarla'
            ELSE 'MAL   5. authenticated puede llamarla' END;
