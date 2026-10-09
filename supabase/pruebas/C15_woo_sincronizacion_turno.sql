-- ============================================================================
-- WooCommerce: el cursor y el turno de la sincronización
-- ============================================================================
-- Prueba 20261024100000_woo_sincronizacion.sql (la tabla, que no tenía prueba)
-- y 20261024110000_woo_sincronizacion_turno.sql.
--
-- Lo que NO prueba aquí: dos sesiones pidiendo el turno en el mismo instante.
-- Eso lo resuelve Postgres con el bloqueo de fila del INSERT ... ON CONFLICT
-- DO UPDATE ... WHERE: la segunda espera a la primera y vuelve a evaluar el
-- WHERE con la fila ya cambiada.

-- 0. Las dos migraciones, dos veces: tienen que poder repetirse. (Las pruebas
--    anteriores dan ALL en todas las tablas a todos los roles; volver a
--    aplicarlas deja los permisos como los deja la migración.)
\ir ../migrations/20261024100000_woo_sincronizacion.sql
\ir ../migrations/20261024110000_woo_sincronizacion_turno.sql
\ir ../migrations/20261024100000_woo_sincronizacion.sql
\ir ../migrations/20261024110000_woo_sincronizacion_turno.sql

INSERT INTO public.tiendas (nombre, slug) VALUES
  ('Tienda C14 A', 'tienda-c14-a'),
  ('Tienda C14 B', 'tienda-c14-b');

CREATE OR REPLACE FUNCTION pg_temp.tienda(_slug TEXT) RETURNS UUID
LANGUAGE sql AS $$ SELECT id FROM public.tiendas WHERE slug = _slug $$;

-- 1. Las columnas nuevas, con su valor por defecto.
SELECT CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'woo_sincronizacion'
                     AND column_name IN ('pedidos_pagina', 'productos_pagina', 'clientes_hasta_id',
                                         'clientes_tope_id', 'clientes_pagina', 'bloqueado_hasta',
                                         'bloqueo_id')) = 7
            THEN 'BIEN  1. woo_sincronizacion tiene la página, los clientes y el turno'
            ELSE 'MAL   1. faltan columnas en woo_sincronizacion' END;

-- 2. Una fila con cursor de antes: coger el turno no la toca.
INSERT INTO public.woo_sincronizacion (tienda_id, pedidos_hasta)
VALUES (pg_temp.tienda('tienda-c14-b'), TIMESTAMPTZ '2026-10-09 08:00:00+00');

-- Todo lo que sigue, como la sincronización: con la clave de servicio.
SET ROLE service_role;

SELECT set_config('c14.turno', public.woo_sincronizacion_tomar(pg_temp.tienda('tienda-c14-a'), 120)::TEXT, false);

SELECT CASE WHEN current_setting('c14.turno') <> ''
             AND (SELECT bloqueado_hasta > now() + interval '110 seconds'
                     AND bloqueo_id::TEXT = current_setting('c14.turno')
                     AND pedidos_pagina = 1 AND productos_pagina = 1 AND clientes_pagina IS NULL
                    FROM public.woo_sincronizacion WHERE tienda_id = pg_temp.tienda('tienda-c14-a'))
            THEN 'BIEN  2. sin fila, tomar el turno la crea con el turno puesto y la página 1'
            ELSE 'MAL   2. tomar el turno no ha dejado la fila como debía' END;

SELECT CASE WHEN public.woo_sincronizacion_tomar(pg_temp.tienda('tienda-c14-b'), 120) IS NOT NULL
             AND (SELECT pedidos_hasta = TIMESTAMPTZ '2026-10-09 08:00:00+00'
                    FROM public.woo_sincronizacion WHERE tienda_id = pg_temp.tienda('tienda-c14-b'))
            THEN 'BIEN  3. con fila y cursor, tomar el turno no toca el cursor'
            ELSE 'MAL   3. tomar el turno ha cambiado el cursor guardado' END;

-- 4. Mientras lo tiene una, la segunda no lo coge.
SELECT CASE WHEN public.woo_sincronizacion_tomar(pg_temp.tienda('tienda-c14-a'), 120) IS NULL
            THEN 'BIEN  4. con el turno cogido, otra sincronización recibe NULL («ya hay una en marcha»)'
            ELSE 'MAL   4. dos sincronizaciones a la vez han cogido el turno' END;

-- 5. Renovar: solo quien lo tiene.
SELECT CASE WHEN public.woo_sincronizacion_renovar(pg_temp.tienda('tienda-c14-a'),
                    current_setting('c14.turno')::UUID, 120)
             AND NOT public.woo_sincronizacion_renovar(pg_temp.tienda('tienda-c14-a'),
                    gen_random_uuid(), 120)
            THEN 'BIEN  5. renueva quien tiene el turno; con otro turno, FALSE'
            ELSE 'MAL   5. la renovación no distingue de quién es el turno' END;

-- 6. Soltar: con otro turno no suelta nada; con el suyo, sí. Paso a paso, en
--    un bloque: dentro de un mismo SELECT, una subconsulta no vería lo que
--    acaban de cambiar las funciones.
DO $$
DECLARE
  v_tienda UUID := (SELECT id FROM public.tiendas WHERE slug = 'tienda-c14-a');
  v_turno UUID := current_setting('c14.turno')::UUID;
BEGIN
  IF public.woo_sincronizacion_soltar(v_tienda, gen_random_uuid()) THEN
    RAISE WARNING 'MAL   6. otro turno ha soltado el de esta sincronización';
  ELSIF public.woo_sincronizacion_tomar(v_tienda, 120) IS NOT NULL THEN
    RAISE WARNING 'MAL   6. tras un soltar ajeno, el turno ha quedado libre';
  ELSIF NOT public.woo_sincronizacion_soltar(v_tienda, v_turno) THEN
    RAISE WARNING 'MAL   6. quien tiene el turno no lo puede soltar';
  ELSIF EXISTS (SELECT 1 FROM public.woo_sincronizacion
                 WHERE tienda_id = v_tienda
                   AND (bloqueado_hasta IS NOT NULL OR bloqueo_id IS NOT NULL)) THEN
    RAISE WARNING 'MAL   6. soltado, el turno sigue puesto';
  ELSE
    RAISE NOTICE 'BIEN  6. solo quien tiene el turno lo suelta, y al soltarlo queda libre';
  END IF;
END $$;

SELECT set_config('c14.turno', public.woo_sincronizacion_tomar(pg_temp.tienda('tienda-c14-a'), 120)::TEXT, false);
SELECT CASE WHEN current_setting('c14.turno') <> ''
            THEN 'BIEN  7. suelto, la siguiente sincronización lo coge'
            ELSE 'MAL   7. suelto, nadie puede cogerlo' END;

-- 8. Caducado: lo coge otra, y la primera ya no puede renovarlo ni soltarlo.
RESET ROLE;
UPDATE public.woo_sincronizacion SET bloqueado_hasta = now() - interval '1 second'
 WHERE tienda_id = pg_temp.tienda('tienda-c14-a');
SET ROLE service_role;

SELECT set_config('c14.otro', public.woo_sincronizacion_tomar(pg_temp.tienda('tienda-c14-a'), 120)::TEXT, false);
SELECT CASE WHEN current_setting('c14.otro') <> ''
             AND current_setting('c14.otro') <> current_setting('c14.turno')
             AND NOT public.woo_sincronizacion_renovar(pg_temp.tienda('tienda-c14-a'),
                    current_setting('c14.turno')::UUID, 120)
             AND NOT public.woo_sincronizacion_soltar(pg_temp.tienda('tienda-c14-a'),
                    current_setting('c14.turno')::UUID)
             AND (SELECT bloqueo_id::TEXT = current_setting('c14.otro')
                    FROM public.woo_sincronizacion WHERE tienda_id = pg_temp.tienda('tienda-c14-a'))
            THEN 'BIEN  8. un turno caducado lo coge otra, y la primera ya no lo renueva ni lo suelta'
            ELSE 'MAL   8. un turno caducado no se comporta como debe' END;

-- 9. Un turno caducado que nadie ha cogido sigue siendo de quien lo tenía.
RESET ROLE;
UPDATE public.woo_sincronizacion SET bloqueado_hasta = now() - interval '1 second'
 WHERE tienda_id = pg_temp.tienda('tienda-c14-a');
SET ROLE service_role;
DO $$
DECLARE
  v_tienda UUID := (SELECT id FROM public.tiendas WHERE slug = 'tienda-c14-a');
BEGIN
  IF NOT public.woo_sincronizacion_renovar(v_tienda, current_setting('c14.otro')::UUID, 120) THEN
    RAISE WARNING 'MAL   9. un turno caducado sin dueño nuevo no se puede renovar';
  ELSIF NOT EXISTS (SELECT 1 FROM public.woo_sincronizacion
                     WHERE tienda_id = v_tienda AND bloqueado_hasta > now()) THEN
    RAISE WARNING 'MAL   9. renovado, el turno sigue caducado';
  ELSE
    RAISE NOTICE 'BIEN  9. caducado y sin nadie que lo coja, quien lo tenía lo renueva';
  END IF;
END $$;

-- 10. Lo que no tiene sentido se rechaza.
DO $$
BEGIN
  PERFORM public.woo_sincronizacion_tomar(gen_random_uuid(), 120);
  RAISE WARNING 'MAL   10. se ha cogido el turno de una tienda que no existe';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  10. una tienda que no existe se rechaza: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM public.woo_sincronizacion_tomar(
    (SELECT id FROM public.tiendas WHERE slug = 'tienda-c14-b'), 0);
  RAISE WARNING 'MAL   11. se ha aceptado un turno de 0 segundos';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  11. un turno de 0 segundos se rechaza: %', SQLERRM;
END $$;

DO $$
BEGIN
  UPDATE public.woo_sincronizacion SET pedidos_pagina = 0
   WHERE tienda_id = (SELECT id FROM public.tiendas WHERE slug = 'tienda-c14-b');
  RAISE WARNING 'MAL   12. se ha guardado la página 0';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'BIEN  12. la página 0 se rechaza (check_violation)';
  WHEN OTHERS THEN
    RAISE WARNING 'MAL   12. la rechazó otra cosa: %', SQLERRM;
END $$;

-- 13. La aplicación guarda el estado con un upsert como este: no toca el turno.
INSERT INTO public.woo_sincronizacion AS w (tienda_id, empresa_id, pedidos_hasta, pedidos_pagina,
                                            clientes_hasta_id, clientes_tope_id, clientes_pagina)
SELECT id, empresa_id, TIMESTAMPTZ '2026-10-09 09:00:00+00', 4, 300, 1000, 3
  FROM public.tiendas WHERE slug = 'tienda-c14-a'
ON CONFLICT (tienda_id) DO UPDATE
   SET pedidos_hasta = EXCLUDED.pedidos_hasta, pedidos_pagina = EXCLUDED.pedidos_pagina,
       clientes_hasta_id = EXCLUDED.clientes_hasta_id, clientes_tope_id = EXCLUDED.clientes_tope_id,
       clientes_pagina = EXCLUDED.clientes_pagina;
SELECT CASE WHEN (SELECT pedidos_pagina = 4 AND clientes_pagina = 3
                     AND bloqueo_id::TEXT = current_setting('c14.otro')
                    FROM public.woo_sincronizacion WHERE tienda_id = pg_temp.tienda('tienda-c14-a'))
            THEN 'BIEN  13. guardar por dónde va no toca el turno'
            ELSE 'MAL   13. guardar por dónde va ha cambiado el turno' END;

RESET ROLE;

-- 14. Permisos: las funciones, solo para la clave de servicio; la tabla, solo
--     lectura para los usuarios.
SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.woo_sincronizacion_tomar(uuid, integer)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.woo_sincronizacion_tomar(uuid, integer)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.woo_sincronizacion_renovar(uuid, uuid, integer)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.woo_sincronizacion_soltar(uuid, uuid)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.woo_sincronizacion_tomar(uuid, integer)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.woo_sincronizacion_renovar(uuid, uuid, integer)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.woo_sincronizacion_soltar(uuid, uuid)', 'EXECUTE')
            THEN 'BIEN  14. el turno solo lo pide la clave de servicio'
            ELSE 'MAL   14. un usuario o anon puede pedir el turno' END;

SELECT CASE WHEN has_table_privilege('authenticated', 'public.woo_sincronizacion', 'SELECT')
             AND NOT has_table_privilege('authenticated', 'public.woo_sincronizacion', 'INSERT')
             AND NOT has_table_privilege('authenticated', 'public.woo_sincronizacion', 'UPDATE')
             AND NOT has_table_privilege('authenticated', 'public.woo_sincronizacion', 'DELETE')
             AND NOT has_table_privilege('anon', 'public.woo_sincronizacion', 'SELECT')
            THEN 'BIEN  15. los usuarios solo leen woo_sincronizacion; anon, nada'
            ELSE 'MAL   15. los permisos de woo_sincronizacion no son los de la migración' END;

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.woo_sincronizacion_tomar(
    (SELECT id FROM public.tiendas WHERE slug = 'tienda-c14-b'), 120);
  RAISE WARNING 'MAL   16. un usuario ha cogido el turno';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'BIEN  16. un usuario que pide el turno recibe permiso denegado';
  WHEN OTHERS THEN
    RAISE WARNING 'MAL   16. lo rechazó otra cosa: %', SQLERRM;
END $$;

SELECT CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.woo_sincronizacion'::regclass)
             AND (SELECT count(*) FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'woo_sincronizacion') = 1
             AND (SELECT cmd FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'woo_sincronizacion') = 'SELECT'
            THEN 'BIEN  17. RLS activada, con una sola política: la de lectura'
            ELSE 'MAL   17. woo_sincronizacion tiene políticas de más o sin RLS' END;

-- 18. Al borrar la tienda se va su fila (ON DELETE CASCADE de la 20261024100000).
--     El borrado se deshace al final del bloque.
DO $$
BEGIN
  BEGIN
    DELETE FROM public.tiendas WHERE slug = 'tienda-c14-b';
    IF EXISTS (SELECT 1 FROM public.woo_sincronizacion w
                 LEFT JOIN public.tiendas t ON t.id = w.tienda_id
                WHERE t.id IS NULL) THEN
      RAISE WARNING 'MAL   18. queda una fila de sincronización sin tienda';
    ELSE
      RAISE NOTICE 'BIEN  18. borrada la tienda, su fila de sincronización se va con ella';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0C14', MESSAGE = 'deshacer el borrado';
  EXCEPTION
    WHEN SQLSTATE 'P0C14' THEN NULL;
    WHEN OTHERS THEN RAISE WARNING 'MAL   18. no se pudo borrar la tienda: %', SQLERRM;
  END;
END $$;
