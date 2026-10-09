-- ============================================================================
-- Conciliación: la ventana cuenta solo lo que todavía se puede conciliar
-- ============================================================================
-- Prueba 20261025100000_conciliacion_pendientes.sql y su reversión.
--
-- Antes de esto ya han pasado C2, C4 y C5, que revierten y vuelven a aplicar
-- 20261014100000, 20261016100000 y 20261017100000 con estas funciones ya
-- creadas: si fueran vistas, esas reversiones habrían fallado.
--
-- Se vuelve a aplicar la migración: así se prueba que se puede aplicar dos
-- veces, y 20_auditoria_autor.sql no tapa el REVOKE que se comprueba en la 8.
\ir ../migrations/20261025100000_conciliacion_pendientes.sql

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

CREATE TEMP TABLE c14 (caso TEXT PRIMARY KEY, id UUID);

CREATE OR REPLACE FUNCTION pg_temp.id(_caso TEXT) RETURNS UUID
LANGUAGE sql AS $$ SELECT id FROM c14 WHERE caso = _caso $$;

CREATE OR REPLACE FUNCTION pg_temp.doc(_tipo TEXT, _caso TEXT) RETURNS JSONB
LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('tipo', _tipo, 'id', pg_temp.id(_caso))) $$;

-- Una factura de la tienda C14. Las de 2035, para no tocar las series de las
-- demás pruebas.
CREATE OR REPLACE FUNCTION pg_temp.factura(_caso TEXT, _fecha DATE, _precio NUMERIC,
                                           _ticket BOOLEAN DEFAULT false)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  v := (public.emitir_factura(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _tienda_id    => (SELECT id FROM public.tiendas WHERE slug = 'tienda-c14'),
    _receptor     => CASE WHEN _ticket THEN NULL
                          ELSE '{"nombre":"Cliente B2B C14","nif":"B12345674"}'::jsonb END,
    _lineas       => jsonb_build_array(jsonb_build_object(
                       'descripcion', 'Metro DTF', 'cantidad', 1, 'unidad', 'm',
                       'precio_unitario', _precio, 'iva_rate', 21)),
    _fecha        => _fecha,
    _simplificada => _ticket) ->> 'id')::UUID;
  INSERT INTO c14 VALUES (_caso, v);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.compra(_caso TEXT, _base NUMERIC, _registrar BOOLEAN DEFAULT true)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.textil_compras
    (empresa_id, proveedor, numero, fecha, base, tipo_iva, tipo_irpf, total, categoria)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'Prov C14', _caso,
          '2035-03-01', _base, 0.21, 0, 0, 'otros')
  RETURNING id INTO v;
  IF _registrar THEN PERFORM public.textil_compra_registrar(v); END IF;
  INSERT INTO c14 VALUES (_caso, v);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.textil(_caso TEXT, _precio NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  v := (public.emitir_factura_textil(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _receptor   => '{"nombre":"Peña C14","nif":"G12345674"}'::jsonb,
    _lineas     => jsonb_build_array(jsonb_build_object(
                     'descripcion', 'Camiseta', 'cantidad', 1,
                     'precio_unitario', _precio, 'iva_rate', 21)),
    _fecha      => DATE '2035-03-01') ->> 'id')::UUID;
  INSERT INTO c14 VALUES (_caso, v);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mov(_caso TEXT, _cuenta TEXT, _fecha DATE, _importe NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella, cuenta_id)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), _fecha, 'C14 ' || _caso, _importe,
          'c14-' || _caso, (SELECT id FROM public.banco_cuentas WHERE alias = _cuenta))
  RETURNING id INTO v;
  INSERT INTO c14 VALUES (_caso, v);
  RETURN v;
END $$;

-- Lo que devuelven las funciones, solo de lo creado aquí.
CREATE OR REPLACE FUNCTION pg_temp.pendientes() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(x.caso, ',' ORDER BY x.caso), '')
    FROM c14 x
   WHERE x.id IN (SELECT id FROM public.banco_documentos_por_conciliar()
                  UNION ALL SELECT id FROM public.banco_movimientos_por_conciliar())
$$;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C14', 'tienda-c14');
INSERT INTO public.banco_cuentas (empresa_id, banco, alias)
SELECT id, 'BBVA', 'C14 principal' FROM public.empresas WHERE activa LIMIT 1;
INSERT INTO public.banco_cuentas (empresa_id, banco, alias)
SELECT id, 'Santander', 'C14 ahorro' FROM public.empresas WHERE activa LIMIT 1;

-- La factura B2B, emitida el 1 de marzo y sin cobrar (1.210 €).
SELECT pg_temp.factura('f-b2b', '2035-03-01', 1000);
-- Treinta tickets después: nacen 'pagada'.
SELECT pg_temp.factura('ticket-' || lpad(n::TEXT, 2, '0'), DATE '2035-03-01' + n, 10, true)
  FROM generate_series(1, 30) n;
-- Una vencida, una que acabará «por revisar» y otra conciliada.
SELECT pg_temp.factura('f-vencida', '2035-03-01', 200);
SELECT public.factura_cambiar_estado_cobro('11111111-1111-4111-8111-111111111111',
                                           pg_temp.id('f-vencida'), 'vencida');
SELECT pg_temp.factura('f-revisar', '2035-03-01', 300);
SELECT pg_temp.factura('f-conciliada', '2035-03-01', 400);

-- Facturas recibidas: pendiente, pagada a mano sin banco, en borrador,
-- borrada y dos que se pagan con un solo cargo.
SELECT pg_temp.compra('c-pendiente', 100);
SELECT pg_temp.compra('c-pagada-a-mano', 50);
UPDATE public.textil_compras SET estado_pago = 'pagada', fecha_pago = '2035-03-02'
 WHERE id = pg_temp.id('c-pagada-a-mano');
SELECT pg_temp.compra('c-borrador', 70, false);
SELECT pg_temp.compra('c-borrada', 80);
UPDATE public.textil_compras SET borrada_en = now() WHERE id = pg_temp.id('c-borrada');
SELECT pg_temp.compra('c-tinta-1', 50);   -- 60,50
SELECT pg_temp.compra('c-tinta-2', 25);   -- 30,25

-- Textil: una libre y una que se enlaza.
SELECT pg_temp.textil('t-libre', 10);
SELECT pg_temp.textil('t-enlazada', 20);

-- Movimientos.
SELECT pg_temp.mov('m-libre', 'C14 principal', '2035-03-20', 1210);
SELECT pg_temp.mov('m-cargo-libre', 'C14 principal', '2035-03-20', -15);
SELECT pg_temp.mov('m-revisar', 'C14 principal', '2035-03-10', 363);
SELECT pg_temp.mov('m-conciliado', 'C14 principal', '2035-03-11', 484);
SELECT pg_temp.mov('m-tintas', 'C14 principal', '2035-03-12', -90.75);
SELECT pg_temp.mov('m-textil', 'C14 principal', '2035-03-13', 24.20);
SELECT pg_temp.mov('m-sale', 'C14 principal', '2035-03-14', -500);
SELECT pg_temp.mov('m-entra', 'C14 ahorro', '2035-03-15', 500);

SELECT set_config('prueba.g_revisar', public.banco_enlazar(
  ARRAY[pg_temp.id('m-revisar')], pg_temp.doc('factura', 'f-revisar'),
  'revisar', 'importe_fecha')::TEXT, false);
SELECT set_config('prueba.g_conciliada', public.banco_enlazar(
  ARRAY[pg_temp.id('m-conciliado')], pg_temp.doc('factura', 'f-conciliada'),
  'conciliada', 'contraparte')::TEXT, false);
SELECT set_config('prueba.g_tintas', public.banco_enlazar(
  ARRAY[pg_temp.id('m-tintas')],
  pg_temp.doc('compra', 'c-tinta-1') || pg_temp.doc('compra', 'c-tinta-2'),
  'revisar', 'suma_documentos')::TEXT, false);
SELECT set_config('prueba.g_textil', public.banco_enlazar(
  ARRAY[pg_temp.id('m-textil')], pg_temp.doc('textil', 't-enlazada'),
  'conciliada', 'manual')::TEXT, false);
SELECT public.banco_marcar_traspaso(pg_temp.id('m-sale'), pg_temp.id('m-entra'));

-- 1. Solo lo pendiente: ni lo pagado, ni lo enlazado, ni los traspasos.
SELECT CASE WHEN pg_temp.pendientes() =
                 'c-pagada-a-mano,c-pendiente,f-b2b,f-vencida,m-cargo-libre,m-libre,t-libre'
            THEN 'BIEN  1. por conciliar: la B2B, la vencida, las recibidas vivas, el textil libre '
                 'y los dos movimientos libres; ni tickets, ni enlazados, ni traspasos'
            ELSE 'MAL   1. por conciliar: ' || pg_temp.pendientes() END;

-- 2. La ventana: los treinta tickets ya no van delante de la factura B2B.
WITH todos AS (
  SELECT id, row_number() OVER (ORDER BY fecha DESC, id) AS n
    FROM public.banco_documentos() WHERE tipo = 'factura'
), pendientes AS (
  SELECT id, row_number() OVER (ORDER BY fecha DESC, id) AS n
    FROM public.banco_documentos_por_conciliar() WHERE tipo = 'factura'
)
SELECT CASE WHEN t.n - p.n >= 30
            THEN 'BIEN  2. la B2B sube ' || (t.n - p.n) || ' puestos: los tickets pagados no '
                 'ocupan la ventana'
            ELSE 'MAL   2. la B2B está en el puesto ' || p.n || ' de lo pendiente y ' || t.n
                 || ' del total' END
  FROM todos t JOIN pendientes p USING (id)
 WHERE id = pg_temp.id('f-b2b');

-- 3. Cada documento con su importe y su referencia, con la forma de siempre.
SELECT CASE WHEN count(*) = 3
             AND bool_and(importe = CASE caso WHEN 'f-b2b' THEN 1210
                                              WHEN 'c-pendiente' THEN 121
                                              WHEN 't-libre' THEN 12.10 END)
             AND bool_and(contraparte IS NOT NULL AND numero IS NOT NULL)
             AND bool_and((tipo = 'factura') = (ejercicio IS NOT NULL))
            THEN 'BIEN  3. importe (total o líquido), contraparte y número en los tres tipos'
            ELSE 'MAL   3. ' || string_agg(caso || '=' || importe, ', ') END
  FROM public.banco_documentos_por_conciliar() d JOIN c14 x USING (id)
 WHERE x.caso IN ('f-b2b', 'c-pendiente', 't-libre');

-- 4. Un enlace por fila, con todos sus datos.
SELECT CASE WHEN e.estado = 'revisar' AND e.motivo = 'importe_fecha' AND e.fecha = '2035-03-10'
             AND jsonb_array_length(e.movimientos) = 1
             AND (e.movimientos -> 0 ->> 'importe')::NUMERIC = 363
             AND e.movimientos -> 0 ->> 'concepto' = 'C14 m-revisar'
             AND jsonb_array_length(e.documentos) = 1
             AND e.documentos -> 0 ->> 'tipo' = 'factura'
             AND (e.documentos -> 0 ->> 'importe')::NUMERIC = 363
             AND e.documentos -> 0 ->> 'contraparte' = 'Cliente B2B C14'
             AND e.documentos -> 0 ->> 'ejercicio' = '2035'
            THEN 'BIEN  4a. el enlace «por revisar» trae su movimiento y su factura con importe'
            ELSE 'MAL   4a. ' || COALESCE(e::TEXT, 'no está') END
  FROM public.banco_enlaces() e WHERE e.grupo = current_setting('prueba.g_revisar')::UUID;

SELECT CASE WHEN count(*) = 1
             AND bool_and(e.estado = 'revisar'
                          AND jsonb_array_length(e.movimientos) = 1
                          AND jsonb_array_length(e.documentos) = 2
                          AND (SELECT sum((d ->> 'importe')::NUMERIC)
                                 FROM jsonb_array_elements(e.documentos) d) = 90.75)
            THEN 'BIEN  4b. un cargo que paga dos recibidas: una fila, un movimiento, dos documentos'
            ELSE 'MAL   4b. ' || count(*) || ' fila(s)' END
  FROM public.banco_enlaces() e WHERE e.grupo = current_setting('prueba.g_tintas')::UUID;

SELECT CASE WHEN e.estado = 'conciliada' AND e.documentos -> 0 ->> 'tipo' = 'textil'
             AND (e.documentos -> 0 ->> 'importe')::NUMERIC = 24.20
            THEN 'BIEN  4c. el enlace con textil, conciliado y con su importe'
            ELSE 'MAL   4c. ' || COALESCE(e::TEXT, 'no está') END
  FROM public.banco_enlaces() e WHERE e.grupo = current_setting('prueba.g_textil')::UUID;

-- 5. Ninguna fila sin datos, en toda la base: tantas filas como grupos, y
--    cada una con algún movimiento y algún documento, todos con importe.
SELECT CASE WHEN (SELECT count(*) FROM public.banco_enlaces())
                 = (SELECT count(DISTINCT grupo) FROM public.banco_conciliaciones)
             AND NOT EXISTS (
               SELECT 1 FROM public.banco_enlaces() e
                WHERE jsonb_array_length(e.movimientos) = 0
                   OR jsonb_array_length(e.documentos) = 0
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.movimientos || e.documentos) x
                               WHERE x ->> 'importe' IS NULL OR x ->> 'fecha' IS NULL))
            THEN 'BIEN  5. un enlace por grupo y ninguno sin movimiento, documento o importe ('
                 || (SELECT count(*) FROM public.banco_enlaces()) || ' enlaces)'
            ELSE 'MAL   5. hay enlaces sin datos o grupos repetidos' END;

-- 6. Al deshacer, lo enlazado vuelve a estar pendiente.
SELECT public.banco_desenlazar(current_setting('prueba.g_revisar')::UUID);
SELECT CASE WHEN pg_temp.pendientes() LIKE '%f-revisar%' AND pg_temp.pendientes() LIKE '%m-revisar%'
             AND NOT EXISTS (SELECT 1 FROM public.banco_enlaces()
                              WHERE grupo = current_setting('prueba.g_revisar')::UUID)
            THEN 'BIEN  6. deshecho el enlace, la factura y el movimiento vuelven a por conciliar'
            ELSE 'MAL   6. ' || pg_temp.pendientes() END;

-- 7. Desmarcar el traspaso devuelve los dos movimientos.
SELECT public.banco_desmarcar_traspaso(pg_temp.id('m-sale'));
SELECT CASE WHEN pg_temp.pendientes() LIKE '%m-sale%' AND pg_temp.pendientes() LIKE '%m-entra%'
            THEN 'BIEN  7. desmarcado el traspaso, los dos movimientos vuelven a por conciliar'
            ELSE 'MAL   7. ' || pg_temp.pendientes() END;

-- 8. Permisos: anon no las ejecuta, y por las funciones se ve lo mismo que
--    leyendo las tablas, ni más ni menos (SECURITY INVOKER).
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.banco_enlaces()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.banco_documentos_por_conciliar()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.banco_movimientos_por_conciliar()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.banco_documentos()', 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.banco_enlaces()', 'EXECUTE')
            THEN 'BIEN  8a. anon no las ejecuta; authenticated sí'
            ELSE 'MAL   8a. permisos de ejecución' END;

BEGIN;
-- Lo que Supabase concede por defecto sobre public y el simulador no: así
-- decide la RLS.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
SET LOCAL ROLE authenticated;
-- Alguien que no es de la empresa. Las facturas de tienda (RLS por tienda) y
-- las de textil (por empresa) no las ve en las tablas, así que tampoco por
-- las funciones, ni dentro de un enlace. (Las recibidas y los movimientos
-- tienen hoy una política de lectura abierta a cualquier autenticado: los ve
-- igual en la tabla que en la función.)
SELECT set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
SELECT CASE WHEN (SELECT count(*) FROM public.facturas) = 0
             AND (SELECT count(*) FROM public.textil_facturas) = 0
             AND (SELECT count(*) FROM public.banco_documentos()
                   WHERE tipo IN ('factura', 'textil')) = 0
             AND NOT EXISTS (SELECT 1 FROM public.banco_enlaces() e,
                                    jsonb_array_elements(e.documentos) d
                              WHERE d ->> 'tipo' IN ('factura', 'textil'))
             AND (SELECT count(*) FROM public.banco_documentos() WHERE tipo = 'compra')
                 = (SELECT count(*) FROM public.textil_compras)
             AND (SELECT count(*) FROM public.banco_movimientos_por_conciliar())
                 <= (SELECT count(*) FROM public.banco_movimientos)
            THEN 'BIEN  8b. quien no es de la empresa ve por las funciones lo mismo que en las '
                 'tablas: ninguna factura de tienda ni de textil'
            ELSE 'MAL   8b. las funciones enseñan algo que la RLS de las tablas no deja ver' END;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT CASE WHEN (SELECT count(*) FROM public.banco_documentos_por_conciliar()) > 0
             AND (SELECT count(*) FROM public.banco_movimientos_por_conciliar()) > 0
             AND (SELECT count(*) FROM public.banco_enlaces()) > 0
            THEN 'BIEN  8c. un miembro de la empresa sí lo ve'
            ELSE 'MAL   8c. un miembro no ve lo suyo' END;
ROLLBACK;

-- 9. La reversión las quita, y se puede volver a aplicar.
\ir ../reversiones/20261025100000_conciliacion_pendientes.sql
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc
                              WHERE proname IN ('banco_documentos', 'banco_documentos_por_conciliar',
                                                'banco_movimientos_por_conciliar', 'banco_enlaces'))
            THEN 'BIEN  9a. la reversión quita las cuatro funciones'
            ELSE 'MAL   9a. la reversión dejó alguna función' END;
\ir ../migrations/20261025100000_conciliacion_pendientes.sql
SELECT CASE WHEN pg_temp.pendientes() LIKE '%f-b2b%'
            THEN 'BIEN  9b. y vuelve a aplicarse'
            ELSE 'MAL   9b. tras volver a aplicarla no funciona' END;
