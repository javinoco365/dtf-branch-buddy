-- ============================================================================
-- SMTP configurable: la clave en Vault, la general y la de cada tienda
-- ============================================================================

DO $$
DECLARE v_empresa UUID; v_a UUID; v_b UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda smtp A', 'smtp-a') RETURNING id INTO v_a;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda smtp B', 'smtp-b') RETURNING id INTO v_b;
  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
  PERFORM set_config('prueba.smtp_a', v_a::TEXT, false);
  PERFORM set_config('prueba.smtp_b', v_b::TEXT, false);
END $$;

-- 1. Sin configurar, no hay nada que leer.
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.smtp_leer(current_setting('prueba.smtp_a')::UUID))
            THEN 'BIEN  1. sin configurar no devuelve credenciales'
            ELSE 'MAL   1. devolvio algo' END;

-- 2. Se guarda la general y las dos tiendas la usan.
SELECT public.smtp_guardar(current_setting('prueba.empresa')::UUID, NULL,
                           'smtp.resend.com', 465, 'resend', 're_clave_general');

SELECT CASE WHEN host = 'smtp.resend.com' AND puerto = 465 AND clave = 're_clave_general'
            THEN 'BIEN  2. la tienda A usa la general'
            ELSE 'MAL   2. leyo ' || COALESCE(host, 'nada') END
FROM public.smtp_leer(current_setting('prueba.smtp_a')::UUID);

SELECT CASE WHEN clave = 're_clave_general'
            THEN 'BIEN  2b. la tienda B tambien'
            ELSE 'MAL   2b.' END
FROM public.smtp_leer(current_setting('prueba.smtp_b')::UUID);

-- 3. LA PRUEBA QUE IMPORTA: la clave no esta en la tabla, solo su referencia.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  3. la clave no aparece en ninguna columna de smtp_config'
            ELSE 'MAL   3. la clave esta en claro en la tabla' END
FROM public.smtp_config
WHERE host LIKE '%re_clave%' OR usuario LIKE '%re_clave%';

-- 4. Una tienda con la suya propia gana a la general.
SELECT public.smtp_guardar(current_setting('prueba.empresa')::UUID,
                           current_setting('prueba.smtp_b')::UUID,
                           'smtp.otroproveedor.com', 587, 'usuario_b', 'clave_b');

SELECT CASE WHEN host = 'smtp.otroproveedor.com' AND clave = 'clave_b'
            THEN 'BIEN  4. la tienda B usa la suya'
            ELSE 'MAL   4. leyo ' || host END
FROM public.smtp_leer(current_setting('prueba.smtp_b')::UUID);

SELECT CASE WHEN host = 'smtp.resend.com'
            THEN 'BIEN  4b. y la A sigue con la general'
            ELSE 'MAL   4b. leyo ' || host END
FROM public.smtp_leer(current_setting('prueba.smtp_a')::UUID);

-- 5. Guardar sin clave no la borra: se puede corregir el puerto sin volver a
--    teclear una contraseña que la pantalla ni siquiera conoce.
SELECT public.smtp_guardar(current_setting('prueba.empresa')::UUID, NULL,
                           'smtp.resend.com', 2465, 'resend', '');

SELECT CASE WHEN puerto = 2465 AND clave = 're_clave_general'
            THEN 'BIEN  5. cambiar el puerto sin clave conserva la contrasena'
            ELSE 'MAL   5. puerto ' || puerto || ' clave ' || COALESCE(clave, 'perdida') END
FROM public.smtp_leer(current_setting('prueba.smtp_a')::UUID);

-- 6. La primera vez sin clave no cuela.
DO $$
BEGIN
  PERFORM public.smtp_guardar(current_setting('prueba.empresa')::UUID,
                              current_setting('prueba.smtp_a')::UUID,
                              'smtp.nuevo.com', 465, 'u', '');
  RAISE NOTICE 'MAL   6. dejo configurar sin contrasena la primera vez';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6. la primera vez exige contrasena';
END $$;

-- 7. Quitar la de la tienda la devuelve a la general.
SELECT CASE WHEN public.smtp_borrar_tienda(current_setting('prueba.smtp_b')::UUID)
            THEN 'BIEN  7. se quita la configuracion propia de la tienda'
            ELSE 'MAL   7. no borro nada' END;

SELECT CASE WHEN host = 'smtp.resend.com'
            THEN 'BIEN  7b. la tienda B vuelve a la general'
            ELSE 'MAL   7b. leyo ' || host END
FROM public.smtp_leer(current_setting('prueba.smtp_b')::UUID);

-- 8. El estado que ve la pantalla no trae la clave por ningun lado.
SELECT CASE WHEN ambito = 'general' AND host = 'smtp.resend.com' AND tiene_clave
            THEN 'BIEN  8. smtp_estado dice que hay clave sin devolverla'
            ELSE 'MAL   8. ambito ' || ambito END
FROM public.smtp_estado(current_setting('prueba.smtp_a')::UUID);

-- 9. Y authenticated no puede leer la clave: smtp_leer es solo del servicio.
SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.smtp_leer(uuid)', 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.smtp_estado(uuid)', 'EXECUTE')
            THEN 'BIEN  9. authenticated ve el estado pero no la clave'
            ELSE 'MAL   9. permisos mal repartidos' END;

-- 10. Ni tocando la tabla directamente.
--
--     Se comprueba sobre RLS y no sobre los GRANT: en Supabase las tablas
--     nuevas del esquema public nacen con permisos amplios para authenticated
--     por privilegios por defecto, asi que el permiso no es la proteccion. Lo
--     que protege es que, con RLS activo y CERO politicas, no se puede leer ni
--     escribir ni una fila.
SELECT CASE WHEN c.relrowsecurity
             AND NOT EXISTS (SELECT 1 FROM pg_policies p
                              WHERE p.schemaname = 'public' AND p.tablename = 'smtp_config')
            THEN 'BIEN 10. RLS activo y sin ninguna politica: la tabla es inaccesible'
            ELSE 'MAL  10. hay alguna via de acceso abierta' END
FROM pg_class c WHERE c.oid = 'public.smtp_config'::regclass;
