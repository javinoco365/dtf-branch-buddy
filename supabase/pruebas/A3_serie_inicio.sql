-- ============================================================================
-- Por dónde empieza la numeración de facturas
-- ============================================================================
-- Arrancar una serie en un número distinto del 1 hace falta el día que la
-- numeración venga de otro programa. Moverla después, no: subiría el contador
-- dejando un hueco, o lo bajaría repitiendo un número.

DO $$
DECLARE v_empresa UUID;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('55555555-5555-4555-8555-555555555555', 'serie@dtfculture.com'),
    ('77777777-7777-4777-8777-777777777777', 'ajeno@example.com');
  INSERT INTO public.user_roles (user_id, role) VALUES
    ('55555555-5555-4555-8555-555555555555', 'admin');
  INSERT INTO public.tiendas (id, nombre, slug)
    VALUES ('66666666-6666-4666-8666-666666666666', 'Tienda de series', 'tienda-series');

  SELECT id INTO v_empresa FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;
  PERFORM set_config('prueba.empresa', v_empresa::TEXT, false);
  -- El ejercicio que viene: aislado de las facturas que ya han emitido las
  -- pruebas anteriores sobre esta misma base, y ademas es el caso real.
  PERFORM set_config('prueba.ejercicio', (EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1)::TEXT, false);
  PERFORM set_config('prueba.fecha', (CURRENT_DATE + INTERVAL '1 year')::DATE::TEXT, false);
END $$;

-- 1. Una serie sin facturas se puede fijar.
SELECT CASE WHEN se_puede_fijar
            THEN 'BIEN  1. la serie ordinaria virgen se puede fijar'
            ELSE 'MAL   1. dice que no se puede fijar estando vacia' END
FROM public.serie_estado(current_setting('prueba.empresa')::UUID,
                    current_setting('prueba.ejercicio')::INT)
WHERE tipo = 'ordinaria';

-- 2. Se fija en 215, como si vinieran 214 facturas de otro programa.
SELECT CASE WHEN (public.serie_fijar_inicio(
              '55555555-5555-4555-8555-555555555555',
              current_setting('prueba.empresa')::UUID,
              current_setting('prueba.ejercicio')::INT,
              'ordinaria', 215) ->> 'proximo_numero') = '215'
            THEN 'BIEN  2. el contador queda en 215'
            ELSE 'MAL   2. no ha quedado en 215' END;

-- 3. La primera factura sale con el 215, no con el 1. Es el punto de todo esto.
SELECT CASE WHEN (public.emitir_factura(
              _usuario_id => '55555555-5555-4555-8555-555555555555',
              _tienda_id  => '66666666-6666-4666-8666-666666666666',
              _receptor   => '{"nombre":"Cliente B2B","nif":"B12345678"}'::jsonb,
              _lineas     => '[{"descripcion":"DTF","cantidad":1,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
              _fecha      => current_setting('prueba.fecha')::DATE
            ) ->> 'numero') = '215'
            THEN 'BIEN  3. la primera factura es la 215'
            ELSE 'MAL   3. no ha salido con el 215' END;

-- 4. Y sigue correlativa desde ahi.
SELECT CASE WHEN (public.emitir_factura(
              _usuario_id => '55555555-5555-4555-8555-555555555555',
              _tienda_id  => '66666666-6666-4666-8666-666666666666',
              _receptor   => '{"nombre":"Cliente B2B","nif":"B12345678"}'::jsonb,
              _lineas     => '[{"descripcion":"DTF","cantidad":1,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
              _fecha      => current_setting('prueba.fecha')::DATE
            ) ->> 'numero') = '216'
            THEN 'BIEN  4. la siguiente es la 216'
            ELSE 'MAL   4. no ha seguido correlativa' END;

-- 5. Con facturas emitidas, la puerta se cierra sola.
SELECT CASE WHEN NOT se_puede_fijar AND emitidas = 2 AND proximo_numero = 217
            THEN 'BIEN  5. con facturas emitidas ya no se puede fijar'
            ELSE 'MAL   5. se_puede_fijar=' || se_puede_fijar
                 || ' emitidas=' || emitidas || ' proximo=' || proximo_numero END
FROM public.serie_estado(current_setting('prueba.empresa')::UUID,
                    current_setting('prueba.ejercicio')::INT)
WHERE tipo = 'ordinaria';

-- 6. Subirlo dejaria un hueco.
DO $$ BEGIN
  PERFORM public.serie_fijar_inicio(
    '55555555-5555-4555-8555-555555555555', current_setting('prueba.empresa')::UUID,
    current_setting('prueba.ejercicio')::INT, 'ordinaria', 900);
  RAISE WARNING 'MAL   6. se ha subido el contador con facturas emitidas';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6. subir el contador con facturas emitidas: rechazado';
END $$;

-- 7. Bajarlo repetiria un numero.
DO $$ BEGIN
  PERFORM public.serie_fijar_inicio(
    '55555555-5555-4555-8555-555555555555', current_setting('prueba.empresa')::UUID,
    current_setting('prueba.ejercicio')::INT, 'ordinaria', 2);
  RAISE WARNING 'MAL   7. se ha bajado el contador con facturas emitidas';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  7. bajar el contador con facturas emitidas: rechazado';
END $$;

-- 8. No hay factura numero 0.
DO $$ BEGIN
  PERFORM public.serie_fijar_inicio(
    '55555555-5555-4555-8555-555555555555', current_setting('prueba.empresa')::UUID,
    current_setting('prueba.ejercicio')::INT, 'rectificativa', 0);
  RAISE WARNING 'MAL   8. se ha aceptado el 0 como proximo numero';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  8. el 0 como proximo numero: rechazado';
END $$;

-- 9. Un ejercicio ya pasado no se prepara.
DO $$ BEGIN
  PERFORM public.serie_fijar_inicio(
    '55555555-5555-4555-8555-555555555555', current_setting('prueba.empresa')::UUID,
    2020, 'ordinaria', 5);
  RAISE WARNING 'MAL   9. se ha aceptado un ejercicio pasado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  9. ejercicio pasado: rechazado';
END $$;

-- 10. Y no lo mueve alguien de fuera de la empresa.
DO $$ BEGIN
  PERFORM public.serie_fijar_inicio(
    '77777777-7777-4777-8777-777777777777', current_setting('prueba.empresa')::UUID,
    current_setting('prueba.ejercicio')::INT, 'rectificativa', 10);
  RAISE WARNING 'MAL  10. un usuario ajeno ha movido el contador';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 10. usuario ajeno a la empresa: rechazado';
END $$;

-- 11. La rectificativa es otra serie: las facturas ordinarias no la cierran.
SELECT CASE WHEN se_puede_fijar AND serie IS DISTINCT FROM
              (SELECT serie FROM public.serie_estado(current_setting('prueba.empresa')::UUID,
                    current_setting('prueba.ejercicio')::INT)
                WHERE tipo = 'ordinaria')
            THEN 'BIEN 11. la serie de rectificativas es aparte y sigue abierta'
            ELSE 'MAL  11. se_puede_fijar=' || se_puede_fijar || ' serie=' || serie END
FROM public.serie_estado(current_setting('prueba.empresa')::UUID,
                    current_setting('prueba.ejercicio')::INT)
WHERE tipo = 'rectificativa';

-- 12. Y su inicio tambien se puede fijar: la anulacion sale con ese numero.
SELECT public.serie_fijar_inicio(
  '55555555-5555-4555-8555-555555555555', current_setting('prueba.empresa')::UUID,
  current_setting('prueba.ejercicio')::INT, 'rectificativa', 30);

SELECT CASE WHEN (public.emitir_factura(
              _usuario_id     => '55555555-5555-4555-8555-555555555555',
              _tienda_id      => '66666666-6666-4666-8666-666666666666',
              _receptor       => '{"nombre":"Cliente B2B","nif":"B12345678"}'::jsonb,
              _lineas         => '[{"descripcion":"DTF","cantidad":-1,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
              _fecha          => current_setting('prueba.fecha')::DATE,
              _rectifica_a_id => (SELECT id FROM public.facturas
                                   WHERE numero = 215 AND ejercicio = current_setting('prueba.ejercicio')::INT),
              _motivo_rectificacion => 'R1'
            ) ->> 'numero') = '30'
            THEN 'BIEN 12. la rectificativa arranca en la 30'
            ELSE 'MAL  12. la rectificativa no ha salido con el 30' END;

-- 13. El navegador no mueve contadores de facturas.
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.serie_fijar_inicio(
    '55555555-5555-4555-8555-555555555555', current_setting('prueba.empresa')::UUID,
    current_setting('prueba.ejercicio')::INT, 'ordinaria', 1);
  RAISE WARNING 'MAL  13. authenticated ha podido mover el contador';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'BIEN 13. authenticated no puede mover el contador';
WHEN OTHERS THEN
  RAISE WARNING 'MAL  13. rechazado, pero por otro motivo: %', SQLERRM;
END $$;
RESET ROLE;

-- 14. Pero si puede leer en que punto va la numeracion.
SET ROLE authenticated;
SELECT CASE WHEN count(*) = 2
            THEN 'BIEN 14. authenticated si puede leer el estado de las series'
            ELSE 'MAL  14. ha devuelto ' || count(*) || ' series' END
FROM public.serie_estado(current_setting('prueba.empresa')::UUID,
                    current_setting('prueba.ejercicio')::INT);
RESET ROLE;

-- 15. Arrancar en 215 no cuenta como hueco: el hueco es un numero asignado sin
--     factura detras, y del 1 al 214 nunca se asignaron aqui.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 15. sin huecos pese a haber arrancado en 215'
            ELSE 'MAL  15. ' || count(*) || ' hueco(s)' END
FROM public.facturas_huecos_en_serie();
