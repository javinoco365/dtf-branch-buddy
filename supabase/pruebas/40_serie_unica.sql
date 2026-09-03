-- ============================================================================
-- Una sola serie para toda la sociedad
-- ============================================================================
-- Se ejecuta después de 10_motor_facturacion.sql, que ya dejó tres facturas
-- ordinarias y una rectificativa emitidas desde la tienda 2222...
-- ============================================================================

-- 1. La referencia que se imprime.
SELECT CASE WHEN public.factura_referencia(serie, ejercicio, numero) = '2026/0001'
            THEN 'BIEN  1. la ordinaria se referencia como 2026/0001'
            ELSE 'MAL   1. salió ' || public.factura_referencia(serie, ejercicio, numero) END
FROM public.facturas WHERE tipo = 'ordinaria' ORDER BY numero LIMIT 1;

-- 2. La rectificativa vive en su propia serie y empieza por 1.
SELECT CASE WHEN serie = 'R' AND numero = 1
            THEN 'BIEN  2. la rectificativa abre serie propia: '
                 || public.factura_referencia(serie, ejercicio, numero)
            ELSE 'MAL   2. serie=' || serie || ' numero=' || numero END
FROM public.facturas WHERE tipo = 'rectificativa' ORDER BY numero LIMIT 1;

-- 3. LA PRUEBA QUE IMPORTA: otra tienda continúa la MISMA numeración.
--    Antes cada tienda tenía su serie y las dos habrían emitido su 2026/0001.
INSERT INTO public.tiendas (id, nombre, empresa_id)
VALUES ('33333333-3333-4333-8333-333333333333', 'Segunda tienda',
        (SELECT empresa_id FROM public.tiendas WHERE id = '22222222-2222-4222-8222-222222222222'));

INSERT INTO public.tienda_usuarios (tienda_id, user_id)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111');

SELECT CASE WHEN (r ->> 'referencia') = '2026/0004'
            THEN 'BIEN  3. otra tienda continúa la serie: ' || (r ->> 'referencia')
            ELSE 'MAL   3. otra tienda emitió ' || (r ->> 'referencia') END
FROM (SELECT public.emitir_factura(
        _usuario_id => '11111111-1111-4111-8111-111111111111',
        _tienda_id  => '33333333-3333-4333-8333-333333333333',
        _receptor   => '{"nombre":"Cliente de la otra tienda","nif":"B87654321"}'::jsonb,
        _lineas     => '[{"descripcion":"Vinilo","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb
      ) AS r) AS x;

-- 4. El textil comparte la misma serie, no la suya.
SELECT CASE WHEN (r ->> 'referencia') = '2026/0005'
            THEN 'BIEN  4. el textil continúa la misma serie: ' || (r ->> 'referencia')
            ELSE 'MAL   4. el textil emitió ' || (r ->> 'referencia') END
FROM (SELECT public.emitir_factura_textil(
        _usuario_id => '11111111-1111-4111-8111-111111111111',
        _receptor   => '{"nombre":"Cliente de mostrador"}'::jsonb,
        _lineas     => '[{"descripcion":"Camiseta","cantidad":2,"unidad":"ud","precio_unitario":9,"iva_rate":21}]'::jsonb
      ) AS r) AS x;

-- 5. El emisor congelado es RONOCA, no la tienda.
SELECT CASE WHEN emisor_snapshot ->> 'razon_social' = 'RONOCA DESARROLLOS S.L.'
             AND emisor_snapshot ->> 'cif' = 'B88931118'
             AND emisor_snapshot ->> 'ciudad' = 'Cartaya'
            THEN 'BIEN  5. el emisor congelado es la sociedad: '
                 || (emisor_snapshot ->> 'razon_social') || ' · ' || (emisor_snapshot ->> 'cif')
            ELSE 'MAL   5. emisor ' || COALESCE(emisor_snapshot ->> 'razon_social', 'NULL') END
FROM public.facturas ORDER BY id DESC LIMIT 1;

-- 6. Cada tienda pone su nombre comercial, la sociedad no cambia.
SELECT CASE WHEN emisor_snapshot ->> 'nombre_comercial' = 'Segunda tienda'
            THEN 'BIEN  6. la tienda aporta el nombre comercial, no la identidad fiscal'
            ELSE 'MAL   6. nombre_comercial ' || COALESCE(emisor_snapshot ->> 'nombre_comercial', 'NULL') END
FROM public.facturas WHERE tienda_id = '33333333-3333-4333-8333-333333333333' LIMIT 1;

-- 7. No se pueden fundir las dos series desde Configuración.
DO $$
BEGIN
  UPDATE public.empresas SET serie_rectificativa = serie_factura;
  RAISE NOTICE 'MAL   7. dejó igualar la serie ordinaria y la de rectificativas';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN  7. no deja igualar las dos series';
END $$;

-- 8. Sigue sin haber huecos con todo mezclado.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  8. sin huecos con DTF, textil y dos tiendas en la misma serie'
            ELSE 'MAL   8. ' || count(*) || ' hueco(s)' END
FROM public.facturas_huecos_en_serie();
