-- ============================================================================
-- Proformas: casar factura, regularizar el stock y pasar el pago
-- ============================================================================
-- Prueba 20261029100000_proformas_motivo.sql y 20261029100100_proformas_compras.sql
-- (contrato: docs/proformas/contrato.md, 1.12 y 7.2).
--
-- La primera va fuera de la transacción (un valor de enum nuevo no se puede
-- usar en la transacción que lo añade; si ya está, no hace nada). La segunda
-- se aplica dos veces dentro: tiene que poder repetirse y, además, repone lo
-- que pisaron C3, C5, C14 y C18 al revertir y reaplicar migraciones viejas.
-- Todo va en una transacción que se deshace al final, salvo el caso 31 (la
-- reversión lleva su propio BEGIN … COMMIT), que va después y es lo último.
\ir ../migrations/20261029100000_proformas_motivo.sql

BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261029100100_proformas_compras.sql
\ir ../migrations/20261029100100_proformas_compras.sql
RESET client_min_messages;

-- Permisos que Supabase concede por defecto sobre public y el simulador no
-- (como en C11 y C18). Así lo que decide en cada caso es la RLS.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ---------------------------------------------------------------------------
-- Datos y ayudas
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c1900000-0000-4000-8000-0000000000ad', 'adm@c19.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c1900000-0000-4000-8000-0000000000ad', 'admin');

CREATE TEMP TABLE c19 (clave TEXT PRIMARY KEY, id UUID, j JSONB);

CREATE FUNCTION pg_temp.id(_c TEXT) RETURNS UUID LANGUAGE sql AS $$
  SELECT id FROM c19 WHERE clave = _c
$$;
CREATE FUNCTION pg_temp.j(_c TEXT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT j FROM c19 WHERE clave = _c
$$;
CREATE FUNCTION pg_temp.guarda(_c TEXT, _id UUID, _j JSONB DEFAULT NULL) RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO c19 VALUES (_c, _id, _j)
  ON CONFLICT (clave) DO UPDATE SET id = EXCLUDED.id, j = EXCLUDED.j RETURNING id
$$;
CREATE FUNCTION pg_temp.adm() RETURNS UUID LANGUAGE sql AS $$
  SELECT 'c1900000-0000-4000-8000-0000000000ad'::UUID
$$;
CREATE FUNCTION pg_temp.empresa() RETURNS UUID LANGUAGE sql AS $$
  SELECT id FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1
$$;
CREATE FUNCTION pg_temp.fecha() RETURNS TEXT LANGUAGE sql AS $$
  SELECT to_char(current_date - 3, 'YYYY-MM-DD')
$$;

-- Una línea de resultado.
CREATE FUNCTION pg_temp.ok(_caso TEXT, _bien BOOLEAN, _detalle TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN COALESCE(_bien, false) THEN 'BIEN  ' || _caso
              ELSE 'MAL   ' || _caso || COALESCE(' -> ' || _detalle, '') END
$$;

-- Una variante nueva, con existencias iniciales si se piden.
CREATE FUNCTION pg_temp.variante(_c TEXT, _nombre TEXT, _color TEXT, _talla TEXT,
                                 _cantidad NUMERIC DEFAULT 0, _coste NUMERIC DEFAULT 0)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.textil_stock (nombre, color, talla) VALUES (_nombre, _color, _talla)
  RETURNING id INTO v;
  IF _cantidad <> 0 THEN
    INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario)
    VALUES (pg_temp.empresa(), v, 'inicial', _cantidad, _coste);
  END IF;
  RETURN pg_temp.guarda(_c, v);
END $$;

-- Una venta (sale al coste medio).
CREATE FUNCTION pg_temp.venta(_stock UUID, _cantidad NUMERIC) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, nota)
  VALUES (pg_temp.empresa(), _stock, 'venta', -_cantidad, 'Venta C19')
$$;

-- Un artículo con su coste de entrada ya repartido.
CREATE FUNCTION pg_temp.art(_desc TEXT, _cant NUMERIC, _importe NUMERIC, _coste NUMERIC,
                            _stock UUID, _extra JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'descripcion', _desc, 'cantidad', _cant, 'precio_unitario', round(_importe / _cant, 4),
    'importe', _importe, 'unidad', NULL, 'tipo', 'articulo', 'referencia', NULL, 'marca', NULL,
    'modelo', NULL, 'color', NULL, 'talla', NULL, 'ean', NULL, 'unidades_por_pack', 1,
    'stock_id', _stock, 'nueva_variante', NULL, 'casado_metodo', 'manual',
    'unidades_stock', _cant, 'coste_total_entrada', _coste,
    'coste_unitario_entrada', round(_coste / _cant, 8), 'linea_papel', NULL) || _extra
$$;

-- Un porte, un descuento u otro cargo.
CREATE FUNCTION pg_temp.otra(_tipo TEXT, _desc TEXT, _importe NUMERIC, _extra JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'descripcion', _desc, 'cantidad', 1, 'precio_unitario', _importe, 'importe', _importe,
    'unidad', NULL, 'tipo', _tipo, 'referencia', NULL, 'marca', NULL, 'modelo', NULL,
    'color', NULL, 'talla', NULL, 'ean', NULL, 'unidades_por_pack', 1, 'stock_id', NULL,
    'nueva_variante', NULL, 'casado_metodo', NULL, 'unidades_stock', NULL,
    'coste_total_entrada', NULL, 'coste_unitario_entrada', NULL, 'linea_papel', NULL) || _extra
$$;

-- El JSON de una compra (RegistroCompra). Por defecto, del proveedor de las
-- proformas y textil.
CREATE FUNCTION pg_temp.compra(_numero TEXT, _base NUMERIC, _lineas JSONB,
                               _extra JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'id', NULL, 'empresa_id', NULL, 'proveedor_id', NULL, 'proveedor', 'Proformas C19 S.L.',
    'nif_proveedor', 'B19000001', 'numero', _numero, 'fecha', pg_temp.fecha(), 'base', _base,
    'iva', round(_base * 0.21, 2), 'irpf', 0, 'total', round(_base * 1.21, 2),
    'categoria', 'textil', 'gasto_id', NULL, 'tipo_iva', 0.21, 'tipo_irpf', 0,
    'liquido_origen', 'calculado', 'nota_descuadre', NULL, 'concepto', NULL,
    'forma_pago', NULL, 'notas', NULL, 'lectura_ia', NULL, 'lineas', _lineas) || _extra
$$;

-- Registrar como el administrador (textil_compra_guardar_y_registrar).
CREATE FUNCTION pg_temp.registrar(_json JSONB) RETURNS JSONB LANGUAGE sql AS $$
  SELECT public.textil_compra_guardar_y_registrar(_json, pg_temp.adm())
$$;

-- Registrar y guardar el id y el resultado con una clave.
CREATE FUNCTION pg_temp.reg(_c TEXT, _json JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  v := pg_temp.registrar(_json);
  PERFORM pg_temp.guarda(_c, (v ->> 'id')::UUID, v);
  RETURN v;
END $$;

-- El error de un registro, o «sin error».
CREATE FUNCTION pg_temp.fallo(_j JSONB) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.registrar(_j);
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- El error de una sentencia (como superusuario), o «sin error».
CREATE FUNCTION pg_temp.fallo_sql(_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_restriccion TEXT;
BEGIN
  EXECUTE _sql;
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
  RETURN SQLSTATE || ' ' || COALESCE('[' || NULLIF(v_restriccion, '') || '] ', '') || SQLERRM;
END $$;

-- Una sentencia como un usuario, con el rol authenticated y su JWT (como C11
-- y C18). Devuelve el número (count o filas afectadas) o «error SQLSTATE mensaje».
CREATE FUNCTION pg_temp.como(_u UUID, _sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _u::TEXT, true);
  SET LOCAL ROLE authenticated;
  IF _sql ~* '^\s*select' THEN
    EXECUTE _sql INTO v_n;
  ELSE
    EXECUTE _sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_n::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE || ' ' || SQLERRM;
END $$;

-- Lo que puede escribir un casado en el libro, la caché y el banco.
CREATE FUNCTION pg_temp.huella() RETURNS TEXT LANGUAGE sql AS $$
  SELECT concat_ws('/',
    (SELECT count(*) FROM public.textil_stock_movimientos),
    (SELECT COALESCE(sum(cantidad), 0) FROM public.textil_stock),
    (SELECT COALESCE(sum(coste_unitario), 0) FROM public.textil_stock),
    (SELECT count(*) FROM public.textil_stock),
    (SELECT count(*) FROM public.textil_compras),
    (SELECT count(*) FROM public.textil_compras WHERE proforma_id IS NOT NULL),
    (SELECT string_agg(COALESCE(compra_id::TEXT, '-') || ':' || COALESCE(importe::TEXT, '-')
                       || ':' || estado || ':' || COALESCE(diferencia::TEXT, '-'), ',' ORDER BY id)
       FROM public.banco_conciliaciones))
$$;

-- P7: Σ entradas compra de la proforma y la factura + Σ ajustes de la factura
-- + devoluciones de la regularización = base de la factura − sin aplicar.
CREATE FUNCTION pg_temp.p7(_f UUID) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN x.izq = x.der AND x.dev = x.dev_resumen THEN 'cuadra'
              ELSE x.izq || ' <> ' || x.der || ' / devoluciones ' || x.dev || ' y ' || x.dev_resumen END
    FROM (
      SELECT (SELECT COALESCE(sum(round(m.cantidad * m.coste_unitario, 2)), 0)
                FROM public.textil_stock_movimientos m
               WHERE m.motivo = 'compra' AND m.compra_id IN (c.id, c.proforma_id))
             + (SELECT COALESCE(sum(m.importe_ajuste), 0) FROM public.textil_stock_movimientos m
                 WHERE m.motivo = 'ajuste_coste' AND m.compra_id = c.id)
             + (SELECT COALESCE(sum(round(m.cantidad * m.coste_unitario, 2)), 0)
                  FROM public.textil_stock_movimientos m
                 WHERE m.motivo = 'devolucion_proveedor' AND m.compra_id = c.id) AS izq,
             c.base - (c.casado_resumen -> 'stock' ->> 'diferencia_sin_aplicar')::NUMERIC AS der,
             (SELECT COALESCE(sum(round(m.cantidad * m.coste_unitario, 2)), 0)
                FROM public.textil_stock_movimientos m
               WHERE m.motivo = 'devolucion_proveedor' AND m.compra_id = c.id) AS dev,
             (c.casado_resumen -> 'stock' ->> 'valor_devoluciones')::NUMERIC AS dev_resumen
        FROM public.textil_compras c WHERE c.id = _f) x
$$;

-- La fila de una variante en el resumen del casado.
CREATE FUNCTION pg_temp.fila(_f UUID, _stock UUID) RETURNS JSONB LANGUAGE sql AS $$
  SELECT v FROM public.textil_compras c,
         jsonb_array_elements(c.casado_resumen -> 'stock' -> 'variantes') v
   WHERE c.id = _f AND (v ->> 'stock_id')::UUID = _stock
$$;

-- Banco: una cuenta y movimientos.
INSERT INTO public.banco_cuentas (empresa_id, banco, alias)
VALUES (pg_temp.empresa(), 'BBVA', 'C19 principal');
CREATE FUNCTION pg_temp.mov(_c TEXT, _importe NUMERIC, _fecha DATE DEFAULT current_date - 2)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella, cuenta_id)
  VALUES (pg_temp.empresa(), _fecha, 'C19 ' || _c, _importe, 'c19-' || _c,
          (SELECT id FROM public.banco_cuentas WHERE alias = 'C19 principal'))
  RETURNING id INTO v;
  RETURN pg_temp.guarda(_c, v);
END $$;
-- Concilia (verde) un movimiento con una compra; devuelve el grupo.
CREATE FUNCTION pg_temp.concilia(_mov UUID, _compra UUID) RETURNS UUID LANGUAGE sql AS $$
  SELECT public.banco_enlazar_como(pg_temp.adm(), ARRAY[_mov],
    jsonb_build_array(jsonb_build_object('tipo', 'compra', 'id', _compra)), 'conciliada', 'manual')
$$;

-- ---------------------------------------------------------------------------
-- 1. Las dos migraciones, aplicadas (dos veces la segunda)
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('1. proformas_version() = 1 y ajuste_coste está en stock_motivo',
                  public.proformas_version() = 1
                  AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                               WHERE t.typname = 'stock_motivo' AND e.enumlabel = 'ajuste_coste'));

-- ---------------------------------------------------------------------------
-- 2. Las compras de antes son facturas; otro tipo no entra
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('2a. las compras que ya había quedan tipo_documento = factura',
                  NOT EXISTS (SELECT 1 FROM public.textil_compras WHERE tipo_documento <> 'factura'));
SELECT pg_temp.ok('2b. tipo_documento = otro: CHECK compra_tipo_documento',
                  r LIKE '23514 [compra_tipo_documento]%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria, tipo_documento)
   VALUES (%L, ''X'', ''C19-2'', current_date - 3, 10, ''otros'', ''otro'')', pg_temp.empresa())) AS r) x;

-- ---------------------------------------------------------------------------
-- 3. Una proforma textil (2 variantes y un porte) mete el stock
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('va', 'Camiseta C19 A', 'Negro', 'M');
SELECT pg_temp.variante('vb', 'Camiseta C19 A', 'Negro', 'L');
SELECT pg_temp.reg('pf1', pg_temp.compra('C19-PF1', 82.50, jsonb_build_array(
         pg_temp.art('Camiseta negra M', 10, 50, 55, pg_temp.id('va')),
         pg_temp.art('Camiseta negra L', 5, 25, 27.50, pg_temp.id('vb')),
         pg_temp.otra('porte', 'Portes', 7.50)), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf1;
SELECT pg_temp.ok('3a. la proforma queda registrada como proforma y el resultado lo dice',
                  c.tipo_documento = 'proforma' AND c.estado = 'registrada'
                  AND pg_temp.j('pf1') ->> 'tipo_documento' = 'proforma'
                  AND (pg_temp.j('pf1') -> 'proforma_id') = 'null'::JSONB
                  AND (pg_temp.j('pf1') -> 'casado') = 'null'::JSONB
                  AND (pg_temp.j('pf1') ->> 'movidas')::INT = 2,
                  c.tipo_documento || ' / ' || pg_temp.j('pf1')::TEXT)
FROM public.textil_compras c WHERE c.id = pg_temp.id('pf1');
SELECT pg_temp.ok('3b. dos entradas compra con compra_id = la proforma, al coste repartido (I1: suman la base)',
                  count(*) = 2 AND sum(round(cantidad * coste_unitario, 2)) = 82.50
                  AND bool_and(compra_linea_id IS NOT NULL),
                  count(*) || ' / ' || sum(round(cantidad * coste_unitario, 2)))
FROM public.textil_stock_movimientos WHERE compra_id = pg_temp.id('pf1') AND motivo = 'compra';
SELECT pg_temp.ok('3c. el stock entra: 10 a 5,50 y 5 a 5,50',
                  a.cantidad = 10 AND a.coste_unitario = 5.5 AND b.cantidad = 5 AND b.coste_unitario = 5.5,
                  a.cantidad || ' a ' || a.coste_unitario || ' / ' || b.cantidad || ' a ' || b.coste_unitario)
FROM public.textil_stock a, public.textil_stock b
WHERE a.id = pg_temp.id('va') AND b.id = pg_temp.id('vb');

-- ---------------------------------------------------------------------------
-- 4. Duplicados: dos proformas con el mismo número no
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('4a. otra proforma del mismo proveedor y número: mensaje de proforma duplicada',
                  r = '23505 Esta proforma (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.', r)
FROM (SELECT pg_temp.fallo(pg_temp.compra('C19-PF1', 10, jsonb_build_array(pg_temp.otra('otro', 'Servicio', 10)),
        '{"tipo_documento": "proforma", "categoria": "otros"}'::JSONB)) AS r) x;

-- ---------------------------------------------------------------------------
-- 5. La proforma, pendiente y conciliable
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('5a. compras_proformas_pendientes() la da',
                  EXISTS (SELECT 1 FROM public.compras_proformas_pendientes() WHERE id = pg_temp.id('pf1')));
SELECT pg_temp.ok('5b. banco_documentos() la da conciliable y con tipo_documento = proforma',
                  conciliable AND tipo_documento = 'proforma', conciliable || ' / ' || COALESCE(tipo_documento, 'nulo'))
FROM public.banco_documentos() WHERE id = pg_temp.id('pf1');
SELECT pg_temp.ok('5c. banco_documentos_por_conciliar() también, con su tipo_documento',
                  tipo_documento = 'proforma', COALESCE(tipo_documento, 'nulo'))
FROM public.banco_documentos_por_conciliar() WHERE id = pg_temp.id('pf1');

-- ---------------------------------------------------------------------------
-- 6. authenticated no pone proforma_id ni casado_resumen
-- ---------------------------------------------------------------------------
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria)
VALUES (pg_temp.empresa(), 'Borrador C19', 'C19-B6', current_date - 3, 10, 'otros');
SELECT pg_temp.ok('6a. INSERT con proforma_id: E-PRO-12',
                  r = 'error 23001 La proforma y su factura solo se casan al registrar la factura, desde su revisión.', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria, proforma_id, casado_resumen)
   VALUES (%L, ''X'', ''C19-6a'', current_date - 3, 10, ''otros'', %L, ''{}'')',
  pg_temp.empresa(), pg_temp.id('pf1'))) AS r) x;
SELECT pg_temp.ok('6b. UPDATE de casado_resumen: E-PRO-12',
                  r = 'error 23001 La proforma y su factura solo se casan al registrar la factura, desde su revisión.', r)
FROM (SELECT pg_temp.como(pg_temp.adm(),
  'UPDATE public.textil_compras SET casado_resumen = ''{}'' WHERE numero = ''C19-B6''') AS r) x;
SELECT pg_temp.ok('6c. UPDATE de proforma_id: E-PRO-12',
                  r = 'error 23001 La proforma y su factura solo se casan al registrar la factura, desde su revisión.', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'UPDATE public.textil_compras SET proforma_id = %L WHERE numero = ''C19-B6''', pg_temp.id('pf1'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 7. Se paga por adelantado: el cargo del banco concilia la proforma
-- ---------------------------------------------------------------------------
SELECT pg_temp.mov('m1', -(SELECT liquido FROM public.textil_compras WHERE id = pg_temp.id('pf1')));
SELECT pg_temp.guarda('g1', pg_temp.concilia(pg_temp.id('m1'), pg_temp.id('pf1')));
SELECT pg_temp.ok('7. conciliada con el cargo: la proforma queda pagada el día del cargo',
                  estado_pago = 'pagada' AND fecha_pago = current_date - 2,
                  estado_pago || ' ' || COALESCE(fecha_pago::TEXT, '-'))
FROM public.textil_compras WHERE id = pg_temp.id('pf1');

-- ---------------------------------------------------------------------------
-- 8. La factura igual que la proforma, casada: nada se mueve
-- ---------------------------------------------------------------------------
SELECT set_config('c19.huella8', pg_temp.huella(), true);
SELECT pg_temp.guarda('auditoria8', NULL, jsonb_build_object('max', (SELECT max(id) FROM public.auditoria)));
SELECT pg_temp.reg('fa1', pg_temp.compra('C19-PF1', 82.50, jsonb_build_array(
         pg_temp.art('Camiseta negra M', 10, 50, 55, pg_temp.id('va')),
         pg_temp.art('Camiseta negra L', 5, 25, 27.50, pg_temp.id('vb')),
         pg_temp.otra('porte', 'Portes', 7.50)), jsonb_build_object('proforma_id', pg_temp.id('pf1')))) IS NOT NULL AS fa1;
SELECT pg_temp.ok('8a. el libro y la caché no cambian: 0 movimientos',
                  (SELECT count(*) FROM public.textil_stock_movimientos WHERE compra_id = pg_temp.id('fa1')) = 0
                  AND (pg_temp.j('fa1') ->> 'movidas')::INT = 0
                  AND split_part(pg_temp.huella(), '/', 1) = split_part(current_setting('c19.huella8'), '/', 1)
                  AND split_part(pg_temp.huella(), '/', 2) = split_part(current_setting('c19.huella8'), '/', 2)
                  AND split_part(pg_temp.huella(), '/', 3) = split_part(current_setting('c19.huella8'), '/', 3),
                  current_setting('c19.huella8') || ' -> ' || pg_temp.huella());
SELECT pg_temp.ok('8b. proforma_id puesto, casado_resumen con 0 movimientos y nada sin aplicar',
                  c.proforma_id = pg_temp.id('pf1') AND c.tipo_documento = 'factura'
                  AND (c.casado_resumen ->> 'proforma_id')::UUID = pg_temp.id('pf1')
                  AND (c.casado_resumen -> 'stock' ->> 'movimientos')::INT = 0
                  AND (c.casado_resumen -> 'stock' ->> 'diferencia_sin_aplicar')::NUMERIC = 0
                  AND (c.casado_resumen -> 'stock' ->> 'valor_proforma')::NUMERIC = 82.50
                  AND jsonb_array_length(c.casado_resumen -> 'stock' -> 'variantes') = 2
                  AND pg_temp.j('fa1') -> 'casado' = c.casado_resumen
                  AND (pg_temp.j('fa1') ->> 'proforma_id')::UUID = pg_temp.id('pf1'),
                  c.casado_resumen::TEXT)
FROM public.textil_compras c WHERE c.id = pg_temp.id('fa1');
SELECT pg_temp.ok('4b. la factura del mismo proveedor y número que la proforma se registró (el tipo va en el único)',
                  estado = 'registrada' AND numero = 'C19-PF1', estado)
FROM public.textil_compras WHERE id = pg_temp.id('fa1');

-- ---------------------------------------------------------------------------
-- 9. El pago pasa a la factura
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('9a. el enlace del banco apunta a la factura, con −líquido de la factura, mismo grupo y marco_pagada',
                  b.compra_id = pg_temp.id('fa1') AND b.importe = -f.liquido AND b.estado = 'conciliada'
                  AND b.diferencia = 0 AND b.marco_pagada,
                  b.compra_id || ' / ' || b.importe || ' / ' || b.estado || ' / ' || b.diferencia)
FROM public.banco_conciliaciones b, public.textil_compras f
WHERE b.grupo = pg_temp.id('g1') AND f.id = pg_temp.id('fa1');
SELECT pg_temp.ok('9b. la factura nace pagada con la fecha de pago de la proforma',
                  f.estado_pago = 'pagada' AND f.fecha_pago = p.fecha_pago,
                  f.estado_pago || ' ' || COALESCE(f.fecha_pago::TEXT, '-'))
FROM public.textil_compras f, public.textil_compras p
WHERE f.id = pg_temp.id('fa1') AND p.id = pg_temp.id('pf1');
SELECT pg_temp.ok('9c. casado_resumen.pago: 1 enlace movido, 1 grupo, ninguno a revisar, pagada',
                  (c.casado_resumen -> 'pago' ->> 'enlaces_movidos')::INT = 1
                  AND (c.casado_resumen -> 'pago' ->> 'grupos')::INT = 1
                  AND (c.casado_resumen -> 'pago' ->> 'grupos_revisar')::INT = 0
                  AND c.casado_resumen -> 'pago' ->> 'estado_pago' = 'pagada',
                  (c.casado_resumen -> 'pago')::TEXT)
FROM public.textil_compras c WHERE c.id = pg_temp.id('fa1');
SELECT pg_temp.ok('9d. el UPDATE del enlace queda en la auditoría con su autor',
                  EXISTS (SELECT 1 FROM public.auditoria a
                           WHERE a.id > (pg_temp.j('auditoria8') ->> 'max')::BIGINT
                             AND a.tabla = 'banco_conciliaciones' AND a.operacion = 'UPDATE'
                             AND a.usuario_id = pg_temp.adm()
                             AND (a.datos_antes ->> 'compra_id')::UUID = pg_temp.id('pf1')
                             AND (a.datos_despues ->> 'compra_id')::UUID = pg_temp.id('fa1')));

-- ---------------------------------------------------------------------------
-- 10. La proforma casada deja de estar pendiente y de ser conciliable
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('10a. compras_proformas_pendientes() ya no la da',
                  NOT EXISTS (SELECT 1 FROM public.compras_proformas_pendientes() WHERE id = pg_temp.id('pf1')));
SELECT pg_temp.ok('10b. banco_documentos() la da no conciliable',
                  NOT conciliable, conciliable::TEXT)
FROM public.banco_documentos() WHERE id = pg_temp.id('pf1');
SELECT pg_temp.mov('m10', -10);
SELECT pg_temp.ok('10c. conciliar la proforma casada: E-PRO-14',
                  r LIKE 'P0001 Esa proforma ya tiene factura (n.º C19-PF1): concilia el pago con la factura.%', r)
FROM (SELECT pg_temp.fallo_sql(format('SELECT pg_temp.concilia(%L, %L)', pg_temp.id('m10'), pg_temp.id('pf1'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 11. La misma proforma con otra factura
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('11. casar la proforma ya casada con otra factura: E-PRO-5',
                  r = '23505 La proforma C19-PF1 ya tiene factura (n.º C19-PF1).', r)
FROM (SELECT pg_temp.fallo(pg_temp.compra('C19-F11', 82.50, jsonb_build_array(
         pg_temp.art('Camiseta negra M', 10, 50, 55, pg_temp.id('va')),
         pg_temp.art('Camiseta negra L', 5, 25, 27.50, pg_temp.id('vb')),
         pg_temp.otra('porte', 'Portes', 7.50)), jsonb_build_object('proforma_id', pg_temp.id('pf1')))) AS r) x;

-- ---------------------------------------------------------------------------
-- 12–14. Unidades distintas: más, menos, solo en la factura, solo en la proforma
-- ---------------------------------------------------------------------------
-- Proforma: S 10, M 4, L 3 (a 5 €). Factura: S 12 (+2), M 3 (−1), XL 2 (solo
-- en la factura); L no viene (solo en la proforma). Las tres de la proforma
-- salen de una línea del papel (caso 28).
SELECT pg_temp.variante('vc', 'Sudadera C19', 'Gris', 'S');
SELECT pg_temp.variante('vd', 'Sudadera C19', 'Gris', 'M');
SELECT pg_temp.variante('ve', 'Sudadera C19', 'Gris', 'L');
SELECT pg_temp.variante('vf', 'Sudadera C19', 'Gris', 'XL');
SELECT pg_temp.reg('pf2', pg_temp.compra('C19-PF2', 85, jsonb_build_array(
         pg_temp.art('Sudadera gris S', 10, 50, 50, pg_temp.id('vc'), '{"linea_papel": 1}'),
         pg_temp.art('Sudadera gris M', 4, 20, 20, pg_temp.id('vd'), '{"linea_papel": 1}'),
         pg_temp.art('Sudadera gris L', 3, 15, 15, pg_temp.id('ve'), '{"linea_papel": 1}')),
         '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf2;
SELECT pg_temp.reg('fa2', pg_temp.compra('C19-FA2', 85, jsonb_build_array(
         pg_temp.art('Sudadera gris S', 12, 60, 60, pg_temp.id('vc')),
         pg_temp.art('Sudadera gris M', 3, 15, 15, pg_temp.id('vd')),
         pg_temp.art('Sudadera gris XL', 2, 10, 10, pg_temp.id('vf'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf2')))) IS NOT NULL AS fa2;
SELECT pg_temp.ok('12a. S: entran 2 (compra, compra_id = la factura, su línea, coste de la factura)',
                  m.cantidad = 2 AND m.coste_unitario = 5 AND l.compra_id = pg_temp.id('fa2')
                  AND l.stock_id = pg_temp.id('vc') AND m.fecha = current_date - 3,
                  m.cantidad || ' a ' || m.coste_unitario)
FROM public.textil_stock_movimientos m JOIN public.textil_compra_lineas l ON l.id = m.compra_linea_id
WHERE m.compra_id = pg_temp.id('fa2') AND m.stock_id = pg_temp.id('vc') AND m.motivo = 'compra';
SELECT pg_temp.ok('12b. P7 cuadra al céntimo', r = 'cuadra', r)
FROM (SELECT pg_temp.p7(pg_temp.id('fa2')) AS r) x;
SELECT pg_temp.ok('13. M: sale 1 como devolucion_proveedor al coste medio, compra_id = la factura',
                  m.cantidad = -1 AND m.coste_unitario = 5 AND m.compra_linea_id IS NULL,
                  m.cantidad || ' a ' || m.coste_unitario)
FROM public.textil_stock_movimientos m
WHERE m.compra_id = pg_temp.id('fa2') AND m.stock_id = pg_temp.id('vd') AND m.motivo = 'devolucion_proveedor';
SELECT pg_temp.ok('14. XL (solo en la factura) entra entera; L (solo en la proforma) sale entera',
                  xl.cantidad = 2 AND l.cantidad = 0
                  AND (pg_temp.fila(pg_temp.id('fa2'), pg_temp.id('vf')) ->> 'entran')::NUMERIC = 2
                  AND (pg_temp.fila(pg_temp.id('fa2'), pg_temp.id('vf')) -> 'coste_unitario_proforma') = 'null'::JSONB
                  AND (pg_temp.fila(pg_temp.id('fa2'), pg_temp.id('ve')) ->> 'salen')::NUMERIC = 3
                  AND (pg_temp.fila(pg_temp.id('fa2'), pg_temp.id('ve')) -> 'coste_unitario_factura') = 'null'::JSONB
                  AND (pg_temp.j('fa2') ->> 'movidas')::INT = 4
                  AND (pg_temp.j('fa2') -> 'casado' -> 'stock' ->> 'entran')::NUMERIC = 4
                  AND (pg_temp.j('fa2') -> 'casado' -> 'stock' ->> 'salen')::NUMERIC = 4,
                  xl.cantidad || ' / ' || l.cantidad || ' / ' || (pg_temp.j('fa2') -> 'casado')::TEXT)
FROM public.textil_stock xl, public.textil_stock l
WHERE xl.id = pg_temp.id('vf') AND l.id = pg_temp.id('ve');

-- ---------------------------------------------------------------------------
-- 15. Precio distinto, con todo el stock: ajuste de coste
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('vg', 'Polo C19', 'Blanco', 'M');
SELECT pg_temp.reg('pf3', pg_temp.compra('C19-PF3', 50, jsonb_build_array(
         pg_temp.art('Polo blanco M', 10, 50, 50, pg_temp.id('vg'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf3;
SELECT pg_temp.reg('fa3', pg_temp.compra('C19-FA3', 60, jsonb_build_array(
         pg_temp.art('Polo blanco M', 10, 60, 60, pg_temp.id('vg'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf3')))) IS NOT NULL AS fa3;
SELECT pg_temp.ok('15a. un ajuste_coste: cantidad 0, importe_ajuste 10,00, compra_id = la factura',
                  count(*) = 1 AND min(m.cantidad) = 0 AND min(m.coste_unitario) = 0
                  AND min(m.importe_ajuste) = 10 AND min(m.fecha) = current_date - 3,
                  count(*) || ' / ' || COALESCE(min(m.importe_ajuste)::TEXT, '-'))
FROM public.textil_stock_movimientos m
WHERE m.compra_id = pg_temp.id('fa3') AND m.motivo = 'ajuste_coste';
SELECT pg_temp.ok('15b. el coste medio sube de 5 a 6, las unidades no cambian y no queda nada sin aplicar',
                  s.cantidad = 10 AND s.coste_unitario = 6
                  AND (pg_temp.fila(pg_temp.id('fa3'), pg_temp.id('vg')) ->> 'importe_sin_aplicar')::NUMERIC = 0
                  AND (pg_temp.fila(pg_temp.id('fa3'), pg_temp.id('vg')) ->> 'unidades_ajustadas')::NUMERIC = 10
                  AND pg_temp.p7(pg_temp.id('fa3')) = 'cuadra',
                  s.cantidad || ' a ' || s.coste_unitario || ' / ' || pg_temp.p7(pg_temp.id('fa3')))
FROM public.textil_stock s WHERE s.id = pg_temp.id('vg');

-- ---------------------------------------------------------------------------
-- 16. Precio distinto con parte vendida: lo vendido no se toca
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('vh', 'Polo C19', 'Azul', 'M');
SELECT pg_temp.reg('pf4', pg_temp.compra('C19-PF4', 50, jsonb_build_array(
         pg_temp.art('Polo azul M', 10, 50, 50, pg_temp.id('vh'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf4;
SELECT pg_temp.venta(pg_temp.id('vh'), 6);
SELECT pg_temp.reg('fa4', pg_temp.compra('C19-FA4', 60, jsonb_build_array(
         pg_temp.art('Polo azul M', 10, 60, 60, pg_temp.id('vh'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf4')))) IS NOT NULL AS fa4;
SELECT pg_temp.ok('16. vendidas 6: ajuste de 4,00 sobre las 4 que quedan, 6,00 sin aplicar, coste 6 y la venta sigue a 5',
                  (f ->> 'unidades_ajustadas')::NUMERIC = 4 AND (f ->> 'importe_ajuste')::NUMERIC = 4
                  AND (f ->> 'importe_sin_aplicar')::NUMERIC = 6
                  AND (SELECT coste_unitario FROM public.textil_stock WHERE id = pg_temp.id('vh')) = 6
                  AND (SELECT coste_unitario FROM public.textil_stock_movimientos
                        WHERE stock_id = pg_temp.id('vh') AND motivo = 'venta') = 5
                  AND pg_temp.p7(pg_temp.id('fa4')) = 'cuadra'
                  AND (pg_temp.j('fa4') -> 'casado' -> 'stock' ->> 'diferencia_sin_aplicar')::NUMERIC = 6,
                  f::TEXT || ' / ' || pg_temp.p7(pg_temp.id('fa4')))
FROM (SELECT pg_temp.fila(pg_temp.id('fa4'), pg_temp.id('vh')) AS f) x;

-- ---------------------------------------------------------------------------
-- 17. Una bajada que dejaría el coste medio en negativo: tope
-- ---------------------------------------------------------------------------
-- 10 a coste 0 de antes + 10 de la proforma a 10 € (media 5); se venden 15
-- (quedan 5 a 5 = 25 €). La factura las cobra a 1 €: −9 × 5 = −45 tumbaría
-- el valor; el ajuste se queda en −25 y el coste en 0.
SELECT pg_temp.variante('vi', 'Gorra C19', 'Negro', 'U', 10, 0);
SELECT pg_temp.reg('pf5', pg_temp.compra('C19-PF5', 100, jsonb_build_array(
         pg_temp.art('Gorra negra', 10, 100, 100, pg_temp.id('vi'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf5;
SELECT pg_temp.venta(pg_temp.id('vi'), 15);
SELECT pg_temp.reg('fa5', pg_temp.compra('C19-FA5', 10, jsonb_build_array(
         pg_temp.art('Gorra negra', 10, 10, 10, pg_temp.id('vi'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf5')))) IS NOT NULL AS fa5;
SELECT pg_temp.ok('17. el ajuste se queda en −25,00 y el coste medio en 0 (nunca negativo); −65,00 sin aplicar',
                  (f ->> 'importe_ajuste')::NUMERIC = -25 AND (f ->> 'importe_sin_aplicar')::NUMERIC = -65
                  AND s.coste_unitario = 0 AND s.cantidad = 5 AND pg_temp.p7(pg_temp.id('fa5')) = 'cuadra',
                  f::TEXT || ' / ' || s.cantidad || ' a ' || s.coste_unitario)
FROM (SELECT pg_temp.fila(pg_temp.id('fa5'), pg_temp.id('vi')) AS f) x,
     public.textil_stock s WHERE s.id = pg_temp.id('vi');

-- ---------------------------------------------------------------------------
-- 18. El ajuste de coste a mano
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('18a. authenticated anota un ajuste_coste: E-AJC-4 (y la caché no cambia)',
                  r = 'error 23001 Los ajustes de coste solo los anota el registro de la factura casada con su proforma (Compras).'
                  AND (SELECT coste_unitario FROM public.textil_stock WHERE id = pg_temp.id('vg')) = 6, r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, importe_ajuste, compra_id)
   VALUES (%L, %L, ''ajuste_coste'', 0, 5, %L)', pg_temp.empresa(), pg_temp.id('vg'), pg_temp.id('fa3'))) AS r) x;
SELECT pg_temp.ok('18b. un ajuste_coste con cantidad 1: E-AJC-1',
                  r = '22023 Un ajuste de coste no mueve unidades: lleva cantidad 0 y un importe distinto de 0.', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, importe_ajuste, compra_id)
   VALUES (%L, %L, ''ajuste_coste'', 1, 5, %L)', pg_temp.empresa(), pg_temp.id('vg'), pg_temp.id('fa3'))) AS r) x;
SELECT pg_temp.variante('vz0', 'Gorra C19 sin existencias', 'Rojo', 'U');
SELECT pg_temp.ok('18c. un ajuste_coste sin existencias: E-AJC-2',
                  r = '23001 No hay existencias de esta variante a las que llevar el ajuste de coste.', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, importe_ajuste, compra_id)
   VALUES (%L, %L, ''ajuste_coste'', 0, 5, %L)', pg_temp.empresa(), pg_temp.id('vz0'), pg_temp.id('fa3'))) AS r) x;
SELECT pg_temp.ok('18d. un ajuste_coste sin factura: CHECK stock_ajuste_coste_completo',
                  r LIKE '23514 [stock_ajuste_coste_completo]%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, importe_ajuste)
   VALUES (%L, %L, ''ajuste_coste'', 0, 5)', pg_temp.empresa(), pg_temp.id('vg'))) AS r) x;
SELECT pg_temp.ok('18e. importe_ajuste en otro motivo: CHECK stock_ajuste_coste_completo',
                  r LIKE '23514 [stock_ajuste_coste_completo]%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, importe_ajuste)
   VALUES (%L, %L, ''merma'', -1, 5)', pg_temp.empresa(), pg_temp.id('vg'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 19. Líquido distinto y proforma conciliada: el grupo queda en «revisar»
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('vj', 'Polo C19', 'Verde', 'M');
SELECT pg_temp.reg('pf6', pg_temp.compra('C19-PF6', 50, jsonb_build_array(
         pg_temp.art('Polo verde M', 10, 50, 50, pg_temp.id('vj'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf6;
SELECT pg_temp.mov('m6', -(SELECT liquido FROM public.textil_compras WHERE id = pg_temp.id('pf6')));
SELECT pg_temp.guarda('g6', pg_temp.concilia(pg_temp.id('m6'), pg_temp.id('pf6')));
SELECT pg_temp.reg('fa6', pg_temp.compra('C19-FA6', 55, jsonb_build_array(
         pg_temp.art('Polo verde M', 10, 55, 55, pg_temp.id('vj'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf6')))) IS NOT NULL AS fa6;
SELECT pg_temp.ok('19. el grupo queda en revisar con diferencia = movimiento − (−líquido de la factura)',
                  b.estado = 'revisar' AND b.compra_id = pg_temp.id('fa6')
                  AND b.diferencia = m.importe + f.liquido AND b.diferencia = 6.05
                  AND (f.casado_resumen -> 'pago' ->> 'grupos_revisar')::INT = 1,
                  b.estado || ' / ' || b.diferencia || ' / ' || (f.casado_resumen -> 'pago')::TEXT)
FROM public.banco_conciliaciones b, public.banco_movimientos m, public.textil_compras f
WHERE b.grupo = pg_temp.id('g6') AND m.id = pg_temp.id('m6') AND f.id = pg_temp.id('fa6');

-- ---------------------------------------------------------------------------
-- 20. Proforma pagada a mano (sin banco)
-- ---------------------------------------------------------------------------
SELECT pg_temp.reg('pf7', pg_temp.compra('C19-PF7', 100, jsonb_build_array(pg_temp.otra('otro', 'Vinilo', 100)),
         '{"tipo_documento": "proforma", "categoria": "material"}'::JSONB)) IS NOT NULL AS pf7;
SELECT pg_temp.ok('20a. authenticated marca pagada la proforma todavía sin factura: sí', r = '1', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'UPDATE public.textil_compras SET estado_pago = ''pagada'', fecha_pago = current_date - 1 WHERE id = %L',
  pg_temp.id('pf7'))) AS r) x;
SELECT pg_temp.reg('fa7', pg_temp.compra('C19-FA7', 100, jsonb_build_array(pg_temp.otra('otro', 'Vinilo', 100)),
         jsonb_build_object('proforma_id', pg_temp.id('pf7'), 'categoria', 'material'))) IS NOT NULL AS fa7;
SELECT pg_temp.ok('20b. la factura nace pagada con esa fecha; ningún enlace movido',
                  f.estado_pago = 'pagada' AND f.fecha_pago = current_date - 1
                  AND (f.casado_resumen -> 'pago' ->> 'enlaces_movidos')::INT = 0
                  AND (f.casado_resumen -> 'pago' ->> 'fecha_pago')::DATE = current_date - 1,
                  f.estado_pago || ' / ' || (f.casado_resumen -> 'pago')::TEXT)
FROM public.textil_compras f WHERE f.id = pg_temp.id('fa7');

-- ---------------------------------------------------------------------------
-- 21. El pago de una proforma casada no se cambia
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('21. authenticated cambia estado_pago de la proforma casada: E-PRO-13',
                  r = 'error 23001 Esta proforma ya tiene factura (n.º C19-FA7): el pago se marca en la factura.', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'UPDATE public.textil_compras SET estado_pago = ''pendiente'', fecha_pago = NULL WHERE id = %L',
  pg_temp.id('pf7'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 22. Lo que no se casa
-- ---------------------------------------------------------------------------
SELECT pg_temp.reg('pf8', pg_temp.compra('C19-PF8', 30, jsonb_build_array(pg_temp.otra('otro', 'Tinta', 30)),
         '{"tipo_documento": "proforma", "categoria": "material"}'::JSONB)) IS NOT NULL AS pf8;
SELECT pg_temp.variante('vn', 'Bolsa C19', 'Crudo', 'U');
SELECT pg_temp.reg('pf9', pg_temp.compra('C19-PF9', 10, jsonb_build_array(
         pg_temp.art('Bolsa cruda', 2, 10, 10, pg_temp.id('vn'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf9;
INSERT INTO public.empresas (id, razon_social, activa)
VALUES ('c1900000-0000-4000-8000-0000000000e2', 'Otra empresa C19', false);
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria, tipo_documento, estado)
VALUES ('c1900000-0000-4000-8000-0000000000e2', 'Ajeno C19', 'C19-AJ', current_date - 3, 30, 'material',
        'proforma', 'registrada');
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria, tipo_documento)
VALUES (pg_temp.empresa(), 'Proformas C19 S.L.', 'C19-BOR', current_date - 3, 30, 'material', 'proforma');

SELECT pg_temp.ok('22.' || n || ' ' || caso, r LIKE esperado, r)
FROM (
  SELECT n, caso, esperado, pg_temp.fallo(j) AS r
  FROM (VALUES
    (1, 'otro proveedor: E-PRO-6',
     '22023 La proforma C19-PF8 es de otro proveedor (Proformas C19 S.L.): solo se casa con una factura del mismo proveedor.',
     pg_temp.compra('C19-F22a', 30, jsonb_build_array(pg_temp.otra('otro', 'Tinta', 30)),
       jsonb_build_object('proforma_id', pg_temp.id('pf8'), 'categoria', 'material',
                          'proveedor', 'Otro C19 S.L.', 'nif_proveedor', 'B19000099'))),
    (2, 'proforma de otra empresa: E-PRO-2', '42501 La proforma es de otra empresa.',
     pg_temp.compra('C19-F22b', 30, jsonb_build_array(pg_temp.otra('otro', 'Tinta', 30)),
       jsonb_build_object('proforma_id', (SELECT id FROM public.textil_compras WHERE numero = 'C19-AJ'),
                          'categoria', 'material'))),
    (3, 'proforma sin registrar: E-PRO-4',
     '23001 La proforma C19-BOR todavía no está registrada o está borrada: regístrala antes de casarla.',
     pg_temp.compra('C19-F22c', 30, jsonb_build_array(pg_temp.otra('otro', 'Tinta', 30)),
       jsonb_build_object('proforma_id', (SELECT id FROM public.textil_compras WHERE numero = 'C19-BOR'),
                          'categoria', 'material'))),
    (4, 'un documento que no es proforma: E-PRO-3', '22023 El documento elegido no es una proforma.',
     pg_temp.compra('C19-F22d', 100, jsonb_build_array(pg_temp.otra('otro', 'Vinilo', 100)),
       jsonb_build_object('proforma_id', pg_temp.id('fa7'), 'categoria', 'material'))),
    (5, 'proforma con proforma_id: E-PRO-8',
     '22023 Una proforma no se casa con otra proforma: lo que se casa con la proforma es su factura.',
     pg_temp.compra('C19-F22e', 10, jsonb_build_array(pg_temp.art('Bolsa cruda', 2, 10, 10, pg_temp.id('vn'))),
       jsonb_build_object('proforma_id', pg_temp.id('pf9'), 'tipo_documento', 'proforma'))),
    (6, 'proforma textil con factura de material: E-PRO-7',
     '22023 Una proforma textil solo se casa con una factura textil, y una de otra categoría con una factura que no sea textil.',
     pg_temp.compra('C19-F22f', 10, jsonb_build_array(pg_temp.otra('otro', 'Bolsas', 10)),
       jsonb_build_object('proforma_id', pg_temp.id('pf9'), 'categoria', 'material'))),
    (7, 'proforma que no existe: E-PRO-1', 'P0002 La proforma elegida no existe.',
     pg_temp.compra('C19-F22g', 10, jsonb_build_array(pg_temp.otra('otro', 'Bolsas', 10)),
       jsonb_build_object('proforma_id', 'c1900000-0000-4000-8000-00000000ffff', 'categoria', 'material'))),
    (8, 'tipo de documento raro: E-PRO-9', '22023 Tipo de documento desconocido: albaran. Tiene que ser factura o proforma.',
     pg_temp.compra('C19-F22h', 10, jsonb_build_array(pg_temp.otra('otro', 'Bolsas', 10)),
       '{"tipo_documento": "albaran", "categoria": "material"}'::JSONB))
  ) AS t (n, caso, esperado, j)
) x ORDER BY n;

-- ---------------------------------------------------------------------------
-- 23. No textil: proforma y factura de material
-- ---------------------------------------------------------------------------
SELECT pg_temp.reg('pf10', pg_temp.compra('C19-PF10', 200, jsonb_build_array(pg_temp.otra('otro', 'Film', 200)),
         '{"tipo_documento": "proforma", "categoria": "material"}'::JSONB)) IS NOT NULL AS pf10;
SELECT pg_temp.mov('m23', -(SELECT liquido FROM public.textil_compras WHERE id = pg_temp.id('pf10')));
SELECT pg_temp.guarda('g23', pg_temp.concilia(pg_temp.id('m23'), pg_temp.id('pf10')));
SELECT pg_temp.reg('fa10', pg_temp.compra('C19-FA10', 200, jsonb_build_array(pg_temp.otra('otro', 'Film', 200)),
         jsonb_build_object('proforma_id', pg_temp.id('pf10'), 'categoria', 'material'))) IS NOT NULL AS fa10;
SELECT pg_temp.ok('23. sin movimientos, casado_resumen.stock = null y el pago pasa',
                  (pg_temp.j('fa10') ->> 'movidas')::INT = 0
                  AND f.casado_resumen -> 'stock' = 'null'::JSONB
                  AND (f.casado_resumen -> 'pago' ->> 'enlaces_movidos')::INT = 1
                  AND f.estado_pago = 'pagada'
                  AND (SELECT compra_id FROM public.banco_conciliaciones WHERE grupo = pg_temp.id('g23')) = f.id
                  AND NOT EXISTS (SELECT 1 FROM public.textil_stock_movimientos WHERE compra_id = f.id),
                  f.casado_resumen::TEXT)
FROM public.textil_compras f WHERE f.id = pg_temp.id('fa10');

-- ---------------------------------------------------------------------------
-- 24. Una compra casada no se borra
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('24a. borrado lógico de la factura casada: E-PRO-11',
                  r = '23001 La compra C19-FA10 está casada con una proforma y no se borra.', r)
FROM (SELECT pg_temp.fallo_sql(format('UPDATE public.textil_compras SET borrada_en = now() WHERE id = %L',
                                      pg_temp.id('fa10'))) AS r) x;
SELECT pg_temp.ok('24b. borrado lógico de la proforma casada: E-PRO-11',
                  r = '23001 La compra C19-PF10 está casada con una proforma y no se borra.', r)
FROM (SELECT pg_temp.fallo_sql(format('UPDATE public.textil_compras SET borrada_en = now() WHERE id = %L',
                                      pg_temp.id('pf10'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 25. El camino viejo no registra proformas
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('25. textil_compra_registrar con una proforma en borrador: E-PRO-10',
                  r = '23001 Las proformas y las facturas casadas con una proforma se registran desde la revisión de Compras.', r)
FROM (SELECT pg_temp.fallo_sql(format('SELECT public.textil_compra_registrar(%L)',
        (SELECT id FROM public.textil_compras WHERE numero = 'C19-BOR'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 26. Atomicidad: un error en la factura casada no deja nada
-- ---------------------------------------------------------------------------
SELECT pg_temp.mov('m26', -(SELECT liquido FROM public.textil_compras WHERE id = pg_temp.id('pf9')));
SELECT pg_temp.guarda('g26', pg_temp.concilia(pg_temp.id('m26'), pg_temp.id('pf9')));
SELECT pg_temp.variante('vz', 'Bolsa C19 retirada', 'Crudo', 'U');
UPDATE public.textil_stock SET activa = false WHERE id = pg_temp.id('vz');
SELECT set_config('c19.huella26', pg_temp.huella(), true);
SELECT pg_temp.ok('26a. una línea con una variante desactivada: el registro falla',
                  r LIKE '23001 Línea 2: la variante está desactivada.%', r)
FROM (SELECT pg_temp.fallo(pg_temp.compra('C19-FA26', 15, jsonb_build_array(
         pg_temp.art('Bolsa cruda', 3, 10, 10, pg_temp.id('vn')),
         pg_temp.art('Bolsa retirada', 1, 5, 5, pg_temp.id('vz'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf9')))) AS r) x;
SELECT pg_temp.ok('26b. y no deja nada: ni stock, ni enlaces movidos, ni proforma_id, ni compra',
                  pg_temp.huella() = current_setting('c19.huella26')
                  AND (SELECT compra_id FROM public.banco_conciliaciones WHERE grupo = pg_temp.id('g26')) = pg_temp.id('pf9')
                  AND EXISTS (SELECT 1 FROM public.compras_proformas_pendientes() WHERE id = pg_temp.id('pf9'))
                  AND NOT EXISTS (SELECT 1 FROM public.textil_compras WHERE numero = 'C19-FA26'),
                  current_setting('c19.huella26') || ' -> ' || pg_temp.huella());

-- ---------------------------------------------------------------------------
-- 27. Inmutables en una registrada (como superusuario)
-- ---------------------------------------------------------------------------
SELECT pg_temp.reg('fa27', pg_temp.compra('C19-FA27', 20, jsonb_build_array(pg_temp.otra('otro', 'Cola', 20)),
         '{"categoria": "material"}'::JSONB)) IS NOT NULL AS fa27;
SELECT pg_temp.ok('27.' || n || ' cambiar ' || k || ' en una registrada: no', r LIKE '23001 La factura % ya está registrada: «' || k || '» no se puede cambiar.%', r)
FROM (
  SELECT n, k, pg_temp.fallo_sql(s) AS r
  FROM (VALUES
    (1, 'tipo_documento', format('UPDATE public.textil_compras SET tipo_documento = ''proforma'' WHERE id = %L', pg_temp.id('fa27'))),
    (2, 'proforma_id', format('UPDATE public.textil_compras SET proforma_id = %L, casado_resumen = ''{}'' WHERE id = %L',
                              pg_temp.id('pf9'), pg_temp.id('fa27'))),
    (3, 'casado_resumen', format('UPDATE public.textil_compras SET casado_resumen = ''{}'' WHERE id = %L', pg_temp.id('fa3')))
  ) AS t (n, k, s)
) x ORDER BY n;

-- ---------------------------------------------------------------------------
-- 28. linea_papel
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('28a. linea_papel se guarda en las tres tallas de la línea 1 del papel',
                  count(*) = 3 AND bool_and(linea_papel = 1), count(*) || ' / ' || string_agg(COALESCE(linea_papel::TEXT, 'nulo'), ','))
FROM public.textil_compra_lineas WHERE compra_id = pg_temp.id('pf2');
SELECT pg_temp.ok('28b. linea_papel = 0: CHECK compra_linea_papel', r LIKE '23514 %compra_linea_papel%', r)
FROM (SELECT pg_temp.fallo(pg_temp.compra('C19-F28', 10, jsonb_build_array(pg_temp.otra('otro', 'Cola', 10, '{"linea_papel": 0}')),
        '{"categoria": "material"}'::JSONB)) AS r) x;

-- ---------------------------------------------------------------------------
-- 29. proforma_entradas(): fusiones y devoluciones a mano
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('vk', 'Camiseta C19 K', 'Rojo', 'M');
SELECT pg_temp.variante('vl', 'Camiseta C19 L', 'Rojo', 'M');
SELECT pg_temp.reg('pf11', pg_temp.compra('C19-PF11', 25, jsonb_build_array(
         pg_temp.art('Camiseta roja M', 3, 15, 15, pg_temp.id('vk')),
         pg_temp.art('Camiseta roja M bis', 2, 10, 10, pg_temp.id('vl'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf11;
SELECT public.textil_stock_fusionar(pg_temp.id('vk'), pg_temp.id('vl'), pg_temp.adm()) IS NOT NULL AS fusionada_29;
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, compra_id, nota)
VALUES (pg_temp.empresa(), pg_temp.id('vl'), 'devolucion_proveedor', -1, pg_temp.id('pf11'), 'Devolución a mano C19');
SELECT pg_temp.ok('29. la variante fusionada sale en su destino; la devolución a mano, en devueltas sin cambiar unidades',
                  count(*) = 1 AND min(stock_id::TEXT)::UUID = pg_temp.id('vl') AND sum(unidades) = 5
                  AND sum(valor) = 25 AND sum(coste_unitario) = 5 AND sum(devueltas) = 1,
                  string_agg(stock_id || ' ' || unidades || ' ' || valor || ' ' || devueltas, '; '))
FROM public.proforma_entradas(pg_temp.id('pf11'));

-- ---------------------------------------------------------------------------
-- 29b. Más unidades y otro coste con parte vendida
-- ---------------------------------------------------------------------------
-- P = 10 a 5 €, F = 12 a 6 €, 8 vendidas antes de casar: entran 2 (ya a 6) y
-- solo se ajustan las 2 de la proforma que quedan: +2,00 y coste 6,0000.
SELECT pg_temp.variante('vm', 'Polo C19', 'Rojo', 'L');
SELECT pg_temp.reg('pf12', pg_temp.compra('C19-PF12', 50, jsonb_build_array(
         pg_temp.art('Polo rojo L', 10, 50, 50, pg_temp.id('vm'))), '{"tipo_documento": "proforma"}'::JSONB)) IS NOT NULL AS pf12;
SELECT pg_temp.venta(pg_temp.id('vm'), 8);
SELECT pg_temp.reg('fa12', pg_temp.compra('C19-FA12', 72, jsonb_build_array(
         pg_temp.art('Polo rojo L', 12, 72, 72, pg_temp.id('vm'))),
         jsonb_build_object('proforma_id', pg_temp.id('pf12')))) IS NOT NULL AS fa12;
SELECT pg_temp.ok('29b. entran 2, unidades_ajustadas 2, importe_ajuste 2,00 y coste medio 6,0000 (no 6,50)',
                  (f ->> 'entran')::NUMERIC = 2 AND (f ->> 'unidades_ajustadas')::NUMERIC = 2
                  AND (f ->> 'importe_ajuste')::NUMERIC = 2 AND s.coste_unitario = 6.0000 AND s.cantidad = 4
                  AND pg_temp.p7(pg_temp.id('fa12')) = 'cuadra',
                  f::TEXT || ' / ' || s.cantidad || ' a ' || s.coste_unitario)
FROM (SELECT pg_temp.fila(pg_temp.id('fa12'), pg_temp.id('vm')) AS f) x,
     public.textil_stock s WHERE s.id = pg_temp.id('vm');

-- ---------------------------------------------------------------------------
-- 29c. El trigger compara con to_jsonb, no con NEW.estado_pago
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('29c. compra_proforma_solo_por_registro no nombra NEW.estado_pago ni OLD.estado_pago',
                  d NOT LIKE '%NEW.estado_pago%' AND d NOT LIKE '%OLD.estado_pago%' AND d LIKE '%to_jsonb%')
FROM (SELECT pg_get_functiondef('public.compra_proforma_solo_por_registro()'::regprocedure) AS d) x;

-- ---------------------------------------------------------------------------
-- 30. Al final, el libro cuadra y la auditoría está entera
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('30. stock_descuadres() vacío y auditoria_verificar() sin eslabones rotos',
                  NOT EXISTS (SELECT 1 FROM public.stock_descuadres())
                  AND NOT EXISTS (SELECT 1 FROM public.auditoria_verificar()));

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 31. Reversión y vuelta a aplicar (fuera de la transacción: la reversión
--     lleva su BEGIN … COMMIT). La base queda como tras aplicar todas las
--     migraciones.
-- ---------------------------------------------------------------------------
SET client_min_messages = warning;
\ir ../reversiones/20261029100100_proformas_compras.sql
\ir ../reversiones/20261029100000_proformas_motivo.sql
RESET client_min_messages;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public'
                                AND (table_name, column_name) IN (
                                  ('textil_compras', 'tipo_documento'), ('textil_compras', 'proforma_id'),
                                  ('textil_compras', 'casado_resumen'), ('textil_compra_lineas', 'linea_papel'),
                                  ('textil_stock_movimientos', 'importe_ajuste')))
             AND NOT EXISTS (SELECT 1 FROM pg_proc
                              WHERE proname IN ('proformas_version', 'proforma_entradas',
                                                'compras_proformas_pendientes', 'textil_stock_destino',
                                                'compra_proforma_solo_por_registro'))
             AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'textil_compras_proforma_solo_por_registro')
             AND to_regclass('public.textil_compras_proforma_casada_unica') IS NULL
             AND to_regclass('public.textil_compras_proformas_abiertas') IS NULL
            THEN 'BIEN  31a. la reversión quita columnas, funciones, trigger e índices nuevos'
            ELSE 'MAL   31a. la reversión dejó algo' END;
SELECT CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'stock_movimiento_no_cero')
                 = 'CHECK ((cantidad <> (0)::numeric))'
             AND (SELECT pg_get_constraintdef(oid) NOT LIKE '%ajuste_coste%' AND pg_get_constraintdef(oid) LIKE '%ajuste_inventario%'
                    FROM pg_constraint WHERE conname = 'stock_movimiento_signo')
             AND (SELECT pg_get_constraintdef(oid) NOT LIKE '%ajuste_coste%' AND pg_get_constraintdef(oid) LIKE '%devolucion_proveedor%'
                    FROM pg_constraint WHERE conname = 'stock_compra_id_motivo')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint
                              WHERE conname IN ('stock_ajuste_coste_completo', 'compra_tipo_documento',
                                                'compra_proforma_solo_factura', 'compra_proforma_no_ella_misma',
                                                'compra_casado_con_proforma', 'compra_linea_papel'))
             AND pg_get_indexdef('public.textil_compras_factura_unica'::regclass)
                 LIKE '%(empresa_id, proveedor_clave, numero_clave)%'
             AND pg_get_function_result('public.banco_documentos()'::regprocedure) NOT LIKE '%tipo_documento%'
             AND pg_get_function_result('public.banco_documentos_por_conciliar()'::regprocedure) NOT LIKE '%tipo_documento%'
             AND (SELECT prosrc NOT LIKE '%Las proformas%' AND prosrc LIKE '%portes, descuentos u otros cargos%'
                    FROM pg_proc WHERE proname = 'textil_compra_registrar')
             AND (SELECT prosrc NOT LIKE '%proforma%' FROM pg_proc WHERE proname = 'textil_compra_guardar_y_registrar')
             AND (SELECT prosrc NOT LIKE '%ajuste_coste%' FROM pg_proc WHERE proname = 'stock_aplicar_movimiento')
             AND (SELECT prosrc NOT LIKE '%proforma%' FROM pg_proc WHERE proname = 'banco_enlazar_como')
            THEN 'BIEN  31b. y repone los CHECK, el índice y las funciones de antes'
            ELSE 'MAL   31b. la reversión no dejó lo de antes' END;
SET client_min_messages = warning;
\ir ../migrations/20261029100000_proformas_motivo.sql
\ir ../migrations/20261029100100_proformas_compras.sql
RESET client_min_messages;
SELECT CASE WHEN public.proformas_version() = 1
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'textil_compras'
                            AND column_name = 'tipo_documento' AND is_nullable = 'NO')
             AND (SELECT pg_get_constraintdef(oid) LIKE '%ajuste_coste%'
                    FROM pg_constraint WHERE conname = 'stock_movimiento_signo')
             AND pg_get_function_result('public.banco_documentos()'::regprocedure) LIKE '%tipo_documento%'
             AND NOT EXISTS (SELECT 1 FROM public.textil_compras WHERE tipo_documento <> 'factura')
            THEN 'BIEN  31c. y se vuelve a aplicar: versión 1, columnas y CHECK de proformas'
            ELSE 'MAL   31c. tras volver a aplicarla no está todo' END;

-- 31d. Con una proforma, la reversión se niega. Va en una transacción que la
-- reversión cierra (su BEGIN dentro de esta solo avisa; su COMMIT, con la
-- transacción ya fallida, la deshace): no queda ni la proforma de prueba ni
-- nada revertido. El ERROR que sale es el esperado, uno solo.
SELECT '(31d) El ERROR de la línea siguiente es el esperado: la reversión se niega con una proforma.' AS aviso;
\set ON_ERROR_STOP off
BEGIN;
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria, tipo_documento)
SELECT id, 'Proforma C19-31', 'C19-31', current_date - 3, 10, 'material', 'proforma'
  FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;
SET client_min_messages = error;
\ir ../reversiones/20261029100100_proformas_compras.sql
\set ON_ERROR_STOP on
RESET client_min_messages;
SELECT CASE WHEN public.proformas_version() = 1
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'textil_compras'
                            AND column_name = 'tipo_documento')
             AND NOT EXISTS (SELECT 1 FROM public.textil_compras WHERE numero = 'C19-31')
            THEN 'BIEN  31d. con una proforma, la reversión se niega y no toca nada'
            ELSE 'MAL   31d. la reversión no se negó o dejó algo' END;
