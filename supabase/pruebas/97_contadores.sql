-- ============================================================================
-- Contadores: dos a la vez no sacan el mismo número
-- ============================================================================

DO $$
DECLARE v_empresa UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
END $$;

-- 1. Empieza en 1 y va de uno en uno.
SELECT CASE WHEN public.siguiente_numero(current_setting('prueba.empresa')::UUID,
                                         'prueba_ambito', 2026) = 1
            THEN 'BIEN  1. el primero es el 1'
            ELSE 'MAL   1. no empezo en 1' END;

SELECT CASE WHEN public.siguiente_numero(current_setting('prueba.empresa')::UUID,
                                         'prueba_ambito', 2026) = 2
            THEN 'BIEN  2. el siguiente es el 2'
            ELSE 'MAL   2. no siguio' END;

-- 3. Cada ámbito lleva su cuenta: los pedidos no gastan números de presupuesto.
SELECT CASE WHEN public.siguiente_numero(current_setting('prueba.empresa')::UUID,
                                         'otro_ambito', 2026) = 1
            THEN 'BIEN  3. cada ambito lleva su propia cuenta'
            ELSE 'MAL   3. compartieron contador' END;

-- 4. Y cada ejercicio la suya: al cambiar de año se reinicia.
SELECT CASE WHEN public.siguiente_numero(current_setting('prueba.empresa')::UUID,
                                         'prueba_ambito', 2027) = 1
            THEN 'BIEN  4. el cambio de ano reinicia la numeracion'
            ELSE 'MAL   4. no reinicio en el ejercicio nuevo' END;

-- 5. La referencia se monta igual que antes: PRES-2026-0007.
SELECT CASE WHEN public.referencia_documento('PRES', 2026, 7) = 'PRES-2026-0007'
            THEN 'BIEN  5. la referencia mantiene el formato de siempre'
            ELSE 'MAL   5. ' || public.referencia_documento('PRES', 2026, 7) END;

-- 6. LA PRUEBA QUE JUSTIFICA TODO: cien números seguidos, ninguno repetido.
--    Con el nextNumero() del navegador, dos sesiones a la vez leian el mismo.
DO $$
DECLARE
  v_distintos INT;
BEGIN
  CREATE TEMP TABLE tirada AS
  SELECT public.siguiente_numero(current_setting('prueba.empresa')::UUID,
                                 'tirada', 2026) AS n
    FROM generate_series(1, 100);

  SELECT count(DISTINCT n) INTO v_distintos FROM tirada;
  IF v_distintos = 100 THEN
    RAISE NOTICE 'BIEN  6. cien numeros seguidos y ninguno repetido';
  ELSE
    RAISE NOTICE 'MAL   6. solo % distintos de 100', v_distintos;
  END IF;
END $$;

-- 7. Y son correlativos, del 1 al 100 sin saltos.
SELECT CASE WHEN min(n) = 1 AND max(n) = 100
            THEN 'BIEN  7. van del 1 al 100 sin saltos'
            ELSE 'MAL   7. de ' || min(n) || ' a ' || max(n) END
FROM tirada;

-- 8. El contador no se escribe a mano: poder reescribirlo seria poder repetir
--    un numero.
--
--    Se comprueba sobre RLS y no sobre los GRANT, porque en Supabase los
--    permisos de tabla NO son la proteccion: las tablas nuevas del esquema
--    public nacen con permisos amplios para authenticated por privilegios por
--    defecto. Lo que protege es que, con RLS activo, una operacion sin politica
--    se deniega. Eso es lo que se comprueba aqui.
SELECT CASE WHEN c.relrowsecurity AND NOT EXISTS (
              SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = 'contadores'
                 AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
            THEN 'BIEN  8. RLS activo y sin ninguna politica de escritura'
            ELSE 'MAL   8. hay alguna via de escritura abierta' END
FROM pg_class c WHERE c.oid = 'public.contadores'::regclass;

-- 8b. Pero la funcion si, porque es SECURITY DEFINER.
SELECT CASE WHEN has_function_privilege('authenticated',
              'public.siguiente_numero(uuid, text, integer)', 'EXECUTE')
            THEN 'BIEN  8b. y puede llamar a siguiente_numero()'
            ELSE 'MAL   8b. no puede llamar a siguiente_numero()' END;

-- 9. La siembra dejó la numeración donde estaba, sin repetir lo existente.
DO $$
DECLARE
  v_contador INT;
BEGIN
  INSERT INTO public.textil_presupuestos (numero, fecha, estado)
  VALUES ('PRES-2026-0041', CURRENT_DATE, 'borrador');

  -- Se vuelve a sembrar como haría la migración al aplicarse sobre datos.
  INSERT INTO public.contadores (empresa_id, ambito, ejercicio, ultimo)
  SELECT current_setting('prueba.empresa')::UUID, 'textil_presupuesto',
         split_part(numero, '-', 2)::INT,
         max(split_part(numero, '-', 3)::INT)
    FROM public.textil_presupuestos
   WHERE numero ~ '^PRES-\d{4}-\d+$'
   GROUP BY split_part(numero, '-', 2)::INT
  ON CONFLICT (empresa_id, ambito, ejercicio)
  DO UPDATE SET ultimo = GREATEST(contadores.ultimo, EXCLUDED.ultimo);

  SELECT ultimo INTO v_contador FROM public.contadores
   WHERE ambito = 'textil_presupuesto' AND ejercicio = 2026;

  IF v_contador = 41 THEN
    RAISE NOTICE 'BIEN  9. la siembra continua donde estaba: el siguiente sera el 42';
  ELSE
    RAISE NOTICE 'MAL   9. el contador quedo en %', v_contador;
  END IF;
END $$;
