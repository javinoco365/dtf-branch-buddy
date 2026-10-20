-- ============================================================================
-- Escáner textil: compras, catálogo, stock y cuentas
-- ============================================================================
-- Prueba 20261028100000_escaner_textil_esquema.sql,
-- 20261028100100_escaner_textil_datos.sql y 20261028100200_escaner_textil_reglas.sql
-- (contrato: docs/escaner-textil/contrato.md, 7.1).
--
-- Las tres se aplican dos veces al empezar (tienen que poder repetirse y,
-- además, reponen las funciones que pisó C1 al reaplicar 20261013100000).
-- Todo va en una transacción que se deshace al final, salvo el caso 24 (las
-- reversiones llevan su propio BEGIN … COMMIT), que va después y es lo último.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261028100000_escaner_textil_esquema.sql
\ir ../migrations/20261028100100_escaner_textil_datos.sql
\ir ../migrations/20261028100200_escaner_textil_reglas.sql
\ir ../migrations/20261028100000_escaner_textil_esquema.sql
\ir ../migrations/20261028100100_escaner_textil_datos.sql
\ir ../migrations/20261028100200_escaner_textil_reglas.sql
RESET client_min_messages;

-- Permisos que Supabase concede por defecto sobre public y el simulador no
-- (como en C11). Así lo que decide en cada caso es la RLS.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ---------------------------------------------------------------------------
-- Datos y ayudas
-- ---------------------------------------------------------------------------
-- ADM es administrador; NADIE no es de ninguna tienda ni tiene rol; SOCIO es
-- de una tienda de la empresa (miembro sin ser administrador).
INSERT INTO auth.users (id, email) VALUES
  ('c1800000-0000-4000-8000-0000000000ad', 'adm@c18.test'),
  ('c1800000-0000-4000-8000-0000000000aa', 'nadie@c18.test'),
  ('c1800000-0000-4000-8000-0000000000ab', 'socio@c18.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c1800000-0000-4000-8000-0000000000ad', 'admin');
INSERT INTO public.tiendas (id, nombre, slug)
VALUES ('c1800000-0000-4000-8000-0000000000e1', 'Tienda C18', 'tienda-c18');
INSERT INTO public.tienda_usuarios (tienda_id, user_id)
VALUES ('c1800000-0000-4000-8000-0000000000e1', 'c1800000-0000-4000-8000-0000000000ab');

CREATE TEMP TABLE c18 (clave TEXT PRIMARY KEY, id UUID);

CREATE FUNCTION pg_temp.id(_c TEXT) RETURNS UUID LANGUAGE sql AS $$
  SELECT id FROM c18 WHERE clave = _c
$$;
CREATE FUNCTION pg_temp.guarda(_c TEXT, _id UUID) RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO c18 VALUES (_c, _id) ON CONFLICT (clave) DO UPDATE SET id = EXCLUDED.id RETURNING id
$$;
CREATE FUNCTION pg_temp.adm() RETURNS UUID LANGUAGE sql AS $$
  SELECT 'c1800000-0000-4000-8000-0000000000ad'::UUID
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

-- Una variante nueva (sin producto: lo pone el trigger), con existencias
-- iniciales si se piden.
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

-- Un artículo de factura con su coste de entrada ya repartido.
CREATE FUNCTION pg_temp.art(_desc TEXT, _cant NUMERIC, _importe NUMERIC, _coste NUMERIC,
                            _stock UUID DEFAULT NULL, _pack NUMERIC DEFAULT 1,
                            _extra JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'descripcion', _desc, 'cantidad', _cant, 'precio_unitario', round(_importe / _cant, 4),
    'importe', _importe, 'unidad', NULL, 'tipo', 'articulo', 'referencia', NULL, 'marca', NULL,
    'modelo', NULL, 'color', NULL, 'talla', NULL, 'ean', NULL, 'unidades_por_pack', _pack,
    'stock_id', _stock, 'nueva_variante', NULL,
    'casado_metodo', CASE WHEN _stock IS NULL THEN NULL ELSE 'manual' END,
    'unidades_stock', _cant * _pack, 'coste_total_entrada', _coste,
    'coste_unitario_entrada', round(_coste / (_cant * _pack), 8)) || _extra
$$;

-- Un porte, un descuento u otro cargo.
CREATE FUNCTION pg_temp.otra(_tipo TEXT, _desc TEXT, _importe NUMERIC)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'descripcion', _desc, 'cantidad', 1, 'precio_unitario', _importe, 'importe', _importe,
    'unidad', NULL, 'tipo', _tipo, 'referencia', NULL, 'marca', NULL, 'modelo', NULL,
    'color', NULL, 'talla', NULL, 'ean', NULL, 'unidades_por_pack', 1, 'stock_id', NULL,
    'nueva_variante', NULL, 'casado_metodo', NULL, 'unidades_stock', NULL,
    'coste_total_entrada', NULL, 'coste_unitario_entrada', NULL)
$$;

-- El JSON de una compra (RegistroCompra, contrato 2.1).
CREATE FUNCTION pg_temp.compra(_numero TEXT, _proveedor TEXT, _nif TEXT, _base NUMERIC,
                               _lineas JSONB, _extra JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'id', NULL, 'empresa_id', NULL, 'proveedor_id', NULL, 'proveedor', _proveedor,
    'nif_proveedor', _nif, 'numero', _numero, 'fecha', pg_temp.fecha(), 'base', _base,
    'iva', round(_base * 0.21, 2), 'irpf', 0, 'total', round(_base * 1.21, 2),
    'categoria', 'textil', 'gasto_id', NULL, 'tipo_iva', 0.21, 'tipo_irpf', 0,
    'liquido_origen', 'calculado', 'nota_descuadre', NULL, 'concepto', NULL,
    'forma_pago', NULL, 'notas', NULL, 'lectura_ia', NULL, 'lineas', _lineas) || _extra
$$;

CREATE FUNCTION pg_temp.reg(_j JSONB, _u UUID DEFAULT 'c1800000-0000-4000-8000-0000000000ad')
RETURNS JSONB LANGUAGE sql AS $$
  SELECT public.textil_compra_guardar_y_registrar(_j, _u)
$$;

-- El error de un registro, o «sin error».
CREATE FUNCTION pg_temp.fallo(_j JSONB, _u UUID DEFAULT 'c1800000-0000-4000-8000-0000000000ad')
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.textil_compra_guardar_y_registrar(_j, _u);
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

-- Una sentencia como un usuario, con el rol authenticated y su JWT (como C11).
-- Devuelve el número (count o filas afectadas) o «error SQLSTATE mensaje».
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

-- Cuántas filas hay de todo lo que puede escribir un registro.
CREATE FUNCTION pg_temp.huella() RETURNS TEXT LANGUAGE sql AS $$
  SELECT concat_ws('/',
    (SELECT count(*) FROM public.textil_compras),
    (SELECT count(*) FROM public.textil_compra_lineas),
    (SELECT count(*) FROM public.proveedores),
    (SELECT count(*) FROM public.textil_productos),
    (SELECT count(*) FROM public.textil_stock),
    (SELECT count(*) FROM public.textil_stock_movimientos),
    (SELECT count(*) FROM public.textil_referencias_proveedor),
    (SELECT COALESCE(sum(cantidad), 0) FROM public.textil_stock))
$$;

-- ---------------------------------------------------------------------------
-- 1. Normalización: los vectores compartidos con el dominio (contrato 2.2)
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('1.' || n || ' ' || f || '(' || COALESCE(e, 'null') || ') = ' || x,
                  r = x, r)
FROM (
  SELECT n, f, e, x,
         CASE f WHEN 'textil_clave' THEN public.textil_clave(e)
                WHEN 'textil_clave_talla' THEN public.textil_clave_talla(e)
                WHEN 'nif_clave' THEN public.nif_clave(e) END AS r
  FROM (VALUES
    (1,  'textil_clave',       '  Camiseta Básica  Ñandú ', 'camisetabasicanandu'),
    (2,  'textil_clave',       NULL,                         ''),
    (3,  'textil_clave',       'B&C #E190',                  'bce190'),
    (4,  'textil_clave_talla', 'xxl',                        '2XL'),
    (5,  'textil_clave_talla', 'Talla M',                    'M'),
    (6,  'textil_clave_talla', '3-4 años',                   '34'),
    (7,  'textil_clave_talla', 'T.U.',                       'UNICA'),
    (8,  'textil_clave_talla', 'One Size',                   'UNICA'),
    (9,  'textil_clave_talla', 'Única',                      'UNICA'),
    (10, 'textil_clave_talla', 'XXXL',                       '3XL'),
    (11, 'textil_clave_talla', '2XL',                        '2XL'),
    (12, 'textil_clave_talla', NULL,                         ''),
    (13, 'nif_clave',          'es-b12.345.678',             'B12345678'),
    (14, 'nif_clave',          'B-12345678',                 'B12345678'),
    (15, 'nif_clave',          ' 12345678z ',                '12345678Z'),
    (16, 'nif_clave',          'ESX1234567L',                'X1234567L'),
    (17, 'nif_clave',          NULL,                         '')
  ) AS v(n, f, e, x)
) t
ORDER BY n;

SELECT pg_temp.ok('1.' || n || ' textil_clave_memoria(' || COALESCE(ref, 'null') || ', '
                  || COALESCE(col, 'null') || ', ' || COALESCE(tal, 'null') || ', '
                  || COALESCE(des, 'null') || ') = «' || x || '»',
                  public.textil_clave_memoria(ref, col, tal, des) = x,
                  public.textil_clave_memoria(ref, col, tal, des))
FROM (VALUES
  (18, '5000', 'Black', 'XXL', 'Camiseta',               'r:5000|black|2XL'),
  (19, NULL,   'Negro', 'L',   'Camiseta Heavy Negro L', 'd:camisetaheavynegrol|negro|L'),
  (20, NULL,   NULL,    NULL,  'Camiseta Heavy Negro L', 'd:camisetaheavynegrol'),
  (21, NULL,   NULL,    'M',   'Sudadera',               'd:sudadera||M'),
  (22, NULL,   NULL,    NULL,  NULL,                     '')
) AS v(n, ref, col, tal, des, x)
ORDER BY n;

-- ---------------------------------------------------------------------------
-- 2. Proveedores únicos por NIF normalizado o, sin NIF, por nombre
-- ---------------------------------------------------------------------------
INSERT INTO public.proveedores (nombre, nif) VALUES ('Proveedor NIF C18', 'B-18000002');
SELECT pg_temp.ok('2a. «ES B18000002» es el mismo proveedor que «B-18000002»',
                  r LIKE '23505%', r)
FROM (SELECT pg_temp.fallo_sql(
  $q$INSERT INTO public.proveedores (nombre, nif) VALUES ('Otro nombre C18', 'ES B18000002')$q$) AS r) x;
INSERT INTO public.proveedores (nombre) VALUES ('Tejidos Sur');
SELECT pg_temp.ok('2b. sin NIF, «TEJIDOS-SUR» es el mismo proveedor que «Tejidos Sur»',
                  r LIKE '23505%', r)
FROM (SELECT pg_temp.fallo_sql(
  $q$INSERT INTO public.proveedores (nombre) VALUES ('TEJIDOS-SUR')$q$) AS r) x;

-- ---------------------------------------------------------------------------
-- 3. Productos y variantes
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v3a', 'Camiseta C18 tres', 'Negro', 'xxl');
SELECT pg_temp.variante('v3b', 'camiseta c18 TRES', 'Blanco', 'M');
SELECT pg_temp.ok('3a. alta sin producto: el producto se crea por el nombre',
                  p.nombre = 'Camiseta C18 tres' AND p.marca IS NULL AND p.referencia IS NULL,
                  p.nombre)
FROM public.textil_stock s JOIN public.textil_productos p ON p.id = s.producto_id
WHERE s.id = pg_temp.id('v3a');
SELECT pg_temp.ok('3b. otra variante con el mismo nombre va al mismo producto',
                  (SELECT producto_id FROM public.textil_stock WHERE id = pg_temp.id('v3a'))
                = (SELECT producto_id FROM public.textil_stock WHERE id = pg_temp.id('v3b')));
SELECT pg_temp.ok('3c. «negro»/«2XL» activa repite a «Negro»/«xxl»: no entra', r LIKE '23505%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock (nombre, producto_id, color, talla) VALUES (%L, %L, %L, %L)',
  'Camiseta C18 tres', (SELECT producto_id FROM public.textil_stock WHERE id = pg_temp.id('v3a')),
  'negro', '2XL')) AS r) x;
SELECT pg_temp.ok('3d. la misma, desactivada, sí entra', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock (nombre, producto_id, color, talla, activa) VALUES (%L, %L, %L, %L, false)',
  'Camiseta C18 tres', (SELECT producto_id FROM public.textil_stock WHERE id = pg_temp.id('v3a')),
  'negro', '2XL')) AS r) x;
UPDATE public.textil_stock SET ean = '4006381333931' WHERE id = pg_temp.id('v3a');
SELECT pg_temp.ok('3e. un EAN repetido en la empresa no entra', r LIKE '23505%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_stock SET ean = %L WHERE id = %L', '4006381333931', pg_temp.id('v3b'))) AS r) x;
SELECT pg_temp.ok('3f. el EAN «123» no tiene formato', r LIKE '23514%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_stock SET ean = %L WHERE id = %L', '123', pg_temp.id('v3b'))) AS r) x;
UPDATE public.textil_stock SET ean = NULL WHERE id = pg_temp.id('v3a');

-- ---------------------------------------------------------------------------
-- 4. RLS de compras y líneas: por empresa y por operación
-- ---------------------------------------------------------------------------
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria)
VALUES (pg_temp.empresa(), 'Visible C18', 'C18-4', current_date - 3, 10, 'otros');
INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad, importe)
SELECT id, 'Línea visible C18', 1, 10 FROM public.textil_compras WHERE numero = 'C18-4';

SELECT pg_temp.ok('4a. compras y líneas: cuatro políticas cada una, por operación, ninguna ALL, todas por empresa',
                  count(*) = 8 AND count(*) FILTER (WHERE cmd = 'ALL') = 0
                  AND count(DISTINCT tablename || cmd) = 8
                  AND bool_and(COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%es_miembro_empresa%'),
                  count(*)::TEXT)
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('textil_compras', 'textil_compra_lineas');
SELECT pg_temp.ok('4b. un usuario sin tienda ni rol no ve compras ni líneas',
                  pg_temp.como('c1800000-0000-4000-8000-0000000000aa', 'SELECT count(*) FROM public.textil_compras') = '0'
                  AND pg_temp.como('c1800000-0000-4000-8000-0000000000aa', 'SELECT count(*) FROM public.textil_compra_lineas') = '0');
SELECT pg_temp.ok('4c. el administrador las ve todas',
                  pg_temp.como(pg_temp.adm(), 'SELECT count(*) FROM public.textil_compras')
                  = (SELECT count(*)::TEXT FROM public.textil_compras)
                  AND pg_temp.como(pg_temp.adm(), 'SELECT count(*) FROM public.textil_compra_lineas')
                  = (SELECT count(*)::TEXT FROM public.textil_compra_lineas));
SELECT pg_temp.ok('4d. authenticated no da de alta una compra ya registrada', r LIKE 'error 42501%', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'INSERT INTO public.textil_compras (empresa_id, numero, estado, categoria) VALUES (%L, %L, %L, %L)',
  pg_temp.empresa(), 'C18-4d', 'registrada', 'otros')) AS r) x;
SELECT pg_temp.ok('4e. el que no es de la empresa no borra un borrador ajeno',
                  pg_temp.como('c1800000-0000-4000-8000-0000000000aa',
                    'DELETE FROM public.textil_compras WHERE numero = ''C18-4''') = '0');

-- ---------------------------------------------------------------------------
-- 5. Registro feliz: portes y descuento repartidos, packs, memoria, autor
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v5a', 'Camiseta C18 cinco', 'Negro', 'M');
SELECT pg_temp.variante('v5b', 'Camiseta C18 cinco', 'Negro', 'L');
DO $$
DECLARE v JSONB; v_id UUID; v_prov UUID;
BEGIN
  v := pg_temp.reg(pg_temp.compra('C18-5', 'Textiles C18 S.L.', 'B18000005', 105,
         jsonb_build_array(
           pg_temp.art('Camiseta C18 negra M', 6, 60, 63, pg_temp.id('v5a')),
           pg_temp.art('Camiseta C18 negra L pack 2', 2, 40, 42, pg_temp.id('v5b'), 2),
           pg_temp.otra('porte', 'Portes', 10),
           pg_temp.otra('descuento', 'Descuento pronto pago', -5))));
  v_id := (v ->> 'id')::UUID;
  v_prov := (v ->> 'proveedor_id')::UUID;
  PERFORM pg_temp.guarda('c5', v_id);
  PERFORM pg_temp.guarda('p5', v_prov);
  RAISE NOTICE '%', pg_temp.ok('5a. registra: 2 movidas, proveedor nuevo',
    (v ->> 'movidas')::INT = 2 AND (v ->> 'proveedor_nuevo')::BOOLEAN
    AND (v ->> 'aprendidas')::INT = 2 AND (v ->> 'variantes_creadas')::INT = 0, v::TEXT);
END $$;
SELECT pg_temp.ok('5b. la compra queda registrada, revisada y enlazada a su proveedor (escáner)',
                  c.estado = 'registrada' AND c.revision = 'revisada' AND c.proveedor_id = pg_temp.id('p5')
                  AND p.origen = 'escaner' AND p.nif_clave = 'B18000005',
                  c.estado || ' ' || c.revision)
FROM public.textil_compras c JOIN public.proveedores p ON p.id = c.proveedor_id
WHERE c.id = pg_temp.id('c5');
SELECT pg_temp.ok('5c. cada movimiento lleva su compra, su línea y la fecha de la factura',
                  count(*) = 2 AND bool_and(m.compra_linea_id = l.id AND m.fecha = c.fecha
                                            AND m.motivo = 'compra'),
                  count(*)::TEXT)
FROM public.textil_stock_movimientos m
JOIN public.textil_compras c ON c.id = m.compra_id
JOIN public.textil_compra_lineas l ON l.id = m.compra_linea_id AND l.compra_id = c.id
WHERE m.compra_id = pg_temp.id('c5');
SELECT pg_temp.ok('5d. Σ coste de entrada = base de la factura: 105,00 al céntimo',
                  round(sum(cantidad * coste_unitario), 2) = 105.00,
                  round(sum(cantidad * coste_unitario), 2)::TEXT)
FROM public.textil_stock_movimientos WHERE compra_id = pg_temp.id('c5');
SELECT pg_temp.ok('5e. entran 6 y 4 unidades (2 packs × 2) a 10,50',
                  (SELECT cantidad FROM public.textil_stock WHERE id = pg_temp.id('v5a')) = 6
                  AND (SELECT cantidad FROM public.textil_stock WHERE id = pg_temp.id('v5b')) = 4
                  AND (SELECT coste_unitario FROM public.textil_stock WHERE id = pg_temp.id('v5b')) = 10.5);
SELECT pg_temp.ok('5f. la memoria aprende dos claves, una vez cada una',
                  count(*) = 2 AND bool_and(veces = 1 AND origen = 'escaner'), count(*)::TEXT)
FROM public.textil_referencias_proveedor WHERE proveedor_id = pg_temp.id('p5');
SELECT pg_temp.ok('5g. la auditoría de la compra tiene autor: el usuario que registra',
                  usuario_id = pg_temp.adm(), COALESCE(usuario_id::TEXT, 'sin autor'))
FROM public.auditoria
WHERE tabla = 'textil_compras' AND registro_id = pg_temp.id('c5')::TEXT
ORDER BY id DESC LIMIT 1;
SELECT pg_temp.ok('5h. las líneas guardan tipo, unidades y coste de entrada',
                  count(*) FILTER (WHERE tipo = 'articulo' AND unidades_stock IS NOT NULL
                                   AND coste_total_entrada IS NOT NULL AND stock_id IS NOT NULL) = 2
                  AND count(*) FILTER (WHERE tipo IN ('porte', 'descuento') AND stock_id IS NULL
                                       AND unidades_stock IS NULL) = 2)
FROM public.textil_compra_lineas WHERE compra_id = pg_temp.id('c5');

-- ---------------------------------------------------------------------------
-- 6. Atomicidad: si el coste de entrada no cuadra, no queda NADA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_antes TEXT := pg_temp.huella(); v_error TEXT;
BEGIN
  v_error := pg_temp.fallo(pg_temp.compra('C18-6', 'Proveedor Atómico C18', 'B18000006', 105,
    jsonb_build_array(
      pg_temp.art('Camiseta C18 negra M', 6, 60, 63, pg_temp.id('v5a')),
      pg_temp.art('Camiseta C18 negra L pack 2', 2, 40, 41.99, pg_temp.id('v5b'), 2),
      pg_temp.otra('porte', 'Portes', 10),
      pg_temp.otra('descuento', 'Descuento', -5))));
  RAISE NOTICE '%', pg_temp.ok('6a. coste de entrada 104,99 con base 105,00: E-REG-15',
    v_error LIKE '22023 El coste de entrada suma 104,99 y la base es 105,00%', v_error);
  RAISE NOTICE '%', pg_temp.ok('6b. y no queda nada: ni compra, ni líneas, ni proveedor, ni variantes, ni movimientos, ni memoria',
    pg_temp.huella() = v_antes, v_antes || ' frente a ' || pg_temp.huella());
END $$;

-- ---------------------------------------------------------------------------
-- 7. Errores del registro, con su mensaje
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v7off', 'Camiseta C18 siete', 'Rojo', 'S');
SELECT public.textil_stock_retirar(pg_temp.id('v7off'));   -- sin movimientos: se borra
SELECT pg_temp.variante('v7off', 'Camiseta C18 siete', 'Rojo', 'S', 1, 1);
SELECT public.textil_stock_retirar(pg_temp.id('v7off'));   -- con movimientos: se desactiva
SELECT pg_temp.variante('v7rep', 'Camiseta C18 siete', 'Verde', 'S');
UPDATE public.textil_stock SET repetida = true WHERE id = pg_temp.id('v7rep');

SELECT pg_temp.ok('7.' || caso || ' ' || que, r LIKE patron, r)
FROM (
  SELECT caso, que, patron, pg_temp.fallo(j, u) AS r
  FROM (VALUES
    ('a', 'sin variante en la línea 2: E-REG-20',
     '23001 Línea 2: falta la variante del catálogo%',
     pg_temp.compra('C18-7a', 'Errores C18', 'B18000007', 20, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a')),
       pg_temp.art('Dos', 1, 10, 10, NULL))), pg_temp.adm()),
    ('b', '1,5 unidades: E-REG-10',
     '22023 Línea 1: las unidades de una prenda tienen que ser enteras y mayores que cero (1,5 × 1 = 1,5)%',
     pg_temp.compra('C18-7b', 'Errores C18', 'B18000007', 15, jsonb_build_array(
       pg_temp.art('Media', 1.5, 15, 15, pg_temp.id('v5a')))), pg_temp.adm()),
    ('c', 'artículo negativo: E-REG-9',
     '22023 Línea 1: un artículo no puede tener importe negativo%',
     pg_temp.compra('C18-7c', 'Errores C18', 'B18000007', -5, jsonb_build_array(
       pg_temp.art('Abono', 1, -5, 0, pg_temp.id('v5a')))), pg_temp.adm()),
    ('d', 'las líneas no suman la base: E-REG-14',
     '22023 Las líneas suman 10,00 y la base dice 12,00%',
     pg_temp.compra('C18-7d', 'Errores C18', 'B18000007', 12, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 12, pg_temp.id('v5a')))), pg_temp.adm()),
    ('e', 'sin artículos: E-REG-8',
     '22023 Una factura textil necesita al menos una línea de artículo.',
     pg_temp.compra('C18-7e', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.otra('porte', 'Portes', 10))), pg_temp.adm()),
    ('f', 'sin fecha: E-REG-5',
     '22023 Falta la fecha de la factura%',
     pg_temp.compra('C18-7f', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a'))), '{"fecha": null}'::JSONB), pg_temp.adm()),
    ('g', 'usuario que no es de la empresa: E-REG-2',
     '42501 Sin acceso a esta empresa.',
     pg_temp.compra('C18-7g', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a')))), 'c1800000-0000-4000-8000-0000000000aa'::UUID),
    ('h', 'variante desactivada: E-REG-17',
     '23001 Línea 1: la variante está desactivada%',
     pg_temp.compra('C18-7h', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v7off')))), pg_temp.adm()),
    ('i', 'variante repetida: E-REG-18',
     '23001 Línea 1: la variante está repetida%',
     pg_temp.compra('C18-7i', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v7rep')))), pg_temp.adm()),
    ('j', 'sin usuario: E-REG-1',
     '22023 Sin usuario: la compra necesita un autor.',
     pg_temp.compra('C18-7j', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a')))), NULL::UUID),
    ('k', 'unidades × coste no dan el coste de la línea: E-REG-12',
     '22023 Línea 1: 2 unidades a 4 no dan 10,00 de coste de entrada.',
     pg_temp.compra('C18-7k', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 2, 10, 10, pg_temp.id('v5a'), 1, '{"coste_unitario_entrada": 4}'::JSONB))),
     pg_temp.adm()),
    ('l', 'un porte negativo: E-REG-13',
     '22023 Línea 2: un porte no puede ser negativo ni un descuento positivo.',
     pg_temp.compra('C18-7l', 'Errores C18', 'B18000007', 5, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 5, pg_temp.id('v5a')),
       pg_temp.otra('porte', 'Portes', -5))), pg_temp.adm()),
    ('m', 'textil sin proveedor: E-REG-7',
     '22023 Falta el proveedor (nombre o NIF)%',
     pg_temp.compra('C18-7m', NULL, NULL, 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a')))), pg_temp.adm()),
    ('n', 'artículo sin coste de entrada: E-REG-11',
     '22023 Línea 1: falta el coste de entrada%',
     pg_temp.compra('C18-7n', 'Errores C18', 'B18000007', 10, jsonb_build_array(
       pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a'), 1, '{"coste_total_entrada": null}'::JSONB))),
     pg_temp.adm())
  ) AS t(caso, que, patron, j, u)
) x
ORDER BY caso;

-- ---------------------------------------------------------------------------
-- 8. Variante nueva desde la línea: producto por marca + referencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE v JSONB; v_nv JSONB;
BEGIN
  v_nv := jsonb_build_object('producto_id', NULL,
            'producto', jsonb_build_object('marca', 'Gildan', 'referencia', '5000-C18',
                                           'nombre', 'Heavy Cotton C18', 'categoria', 'camiseta'),
            'color', 'Negro', 'talla', NULL, 'ean', NULL, 'sku', NULL,
            'precio_venta', 9.5, 'cantidad_minima', 0);
  v := pg_temp.reg(pg_temp.compra('C18-8', 'Mayorista C18', 'B18000008', 60, jsonb_build_array(
         pg_temp.art('Heavy Cotton negra M', 2, 20, 20, NULL, 1, jsonb_build_object(
           'referencia', '5000', 'color', 'Negro', 'talla', 'M', 'ean', '4006381333931',
           'nueva_variante', v_nv || '{"talla": "M"}'::JSONB)),
         pg_temp.art('Heavy Cotton negra L', 2, 20, 20, NULL, 1, jsonb_build_object(
           'referencia', '5000', 'color', 'Negro', 'talla', 'L',
           'nueva_variante', v_nv || '{"talla": "L"}'::JSONB)),
         pg_temp.art('Heavy Cotton negra M', 2, 20, 20, NULL, 1, jsonb_build_object(
           'referencia', '5000', 'color', 'Negro', 'talla', 'm',
           'nueva_variante', v_nv || '{"talla": "m"}'::JSONB)))));
  PERFORM pg_temp.guarda('c8', (v ->> 'id')::UUID);
  PERFORM pg_temp.guarda('p8', (v ->> 'proveedor_id')::UUID);
  RAISE NOTICE '%', pg_temp.ok('8a. dos variantes creadas para tres líneas (M, L y otra M)',
    (v ->> 'variantes_creadas')::INT = 2 AND (v ->> 'movidas')::INT = 3, v::TEXT);
END $$;
SELECT pg_temp.ok('8b. un producto nuevo con origen escáner, con sus dos variantes',
                  count(DISTINCT p.id) = 1 AND bool_and(p.origen = 'escaner' AND p.marca = 'Gildan')
                  AND count(DISTINCT s.id) = 2,
                  count(DISTINCT p.id) || ' productos, ' || count(DISTINCT s.id) || ' variantes')
FROM public.textil_productos p JOIN public.textil_stock s ON s.producto_id = p.id
WHERE p.referencia = '5000-C18';
SELECT pg_temp.ok('8c. las dos líneas M van a la misma variante, que tiene 4 unidades',
                  count(DISTINCT l.stock_id) = 1 AND min(s.cantidad) = 4 AND bool_and(l.casado_metodo = 'nueva'))
FROM public.textil_compra_lineas l JOIN public.textil_stock s ON s.id = l.stock_id
WHERE l.compra_id = pg_temp.id('c8') AND l.descripcion = 'Heavy Cotton negra M';
SELECT pg_temp.ok('8d. el EAN de la línea se aprende en su variante',
                  s.ean = '4006381333931' AND s.precio_venta = 9.5 AND s.nombre = 'Heavy Cotton C18',
                  COALESCE(s.ean, 'sin EAN'))
FROM public.textil_compra_lineas l JOIN public.textil_stock s ON s.id = l.stock_id
WHERE l.compra_id = pg_temp.id('c8') AND l.orden = 0;
SELECT pg_temp.guarda('v8m', stock_id) FROM public.textil_compra_lineas
 WHERE compra_id = pg_temp.id('c8') AND orden = 0;
SELECT pg_temp.guarda('v8l', stock_id) FROM public.textil_compra_lineas
 WHERE compra_id = pg_temp.id('c8') AND orden = 1;

-- ---------------------------------------------------------------------------
-- 9. La misma factura otra vez: E-REG-21, y tampoco queda nada
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_antes TEXT := pg_temp.huella(); v_error TEXT;
BEGIN
  v_error := pg_temp.fallo(pg_temp.compra('C18-5', 'Textiles C18 S.L.', 'B18000005', 10,
    jsonb_build_array(pg_temp.art('Polo nuevo C18', 1, 10, 10, NULL, 1, jsonb_build_object(
      'nueva_variante', jsonb_build_object('producto_id', NULL,
        'producto', jsonb_build_object('marca', NULL, 'referencia', NULL, 'nombre', 'Polo duplicado C18',
                                       'categoria', NULL),
        'color', 'Azul', 'talla', 'S', 'ean', NULL, 'sku', NULL, 'precio_venta', 0,
        'cantidad_minima', 0))))));
  RAISE NOTICE '%', pg_temp.ok('9a. mismo proveedor y número: E-REG-21 (unique_violation)',
    v_error LIKE '23505 Esta factura (mismo proveedor y número) ya está registrada%', v_error);
  RAISE NOTICE '%', pg_temp.ok('9b. sin rastro: ni la variante nueva ni su entrada de stock',
    pg_temp.huella() = v_antes, v_antes || ' frente a ' || pg_temp.huella());
END $$;

-- ---------------------------------------------------------------------------
-- 10. La cabecera de una compra registrada no cambia
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('10a. cambiar la base de una registrada: no', r LIKE '23001 La factura C18-5 ya está registrada: «base»%', r)
FROM (SELECT pg_temp.fallo_sql(format('UPDATE public.textil_compras SET base = 1 WHERE id = %L', pg_temp.id('c5'))) AS r) x;
SELECT pg_temp.ok('10b. marcarla pagada con su fecha: sí', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET estado_pago = ''pagada'', fecha_pago = current_date WHERE id = %L',
  pg_temp.id('c5'))) AS r) x;
SELECT pg_temp.ok('10c. adjuntar el fichero (de nulo a un valor): sí', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET fichero_ruta = ''ronoca/2026/c18.pdf'' WHERE id = %L',
  pg_temp.id('c5'))) AS r) x;
SELECT pg_temp.ok('10d. cambiar el fichero ya adjunto: no', r LIKE '23001%«fichero_ruta»%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET fichero_ruta = ''ronoca/2026/otro.pdf'' WHERE id = %L',
  pg_temp.id('c5'))) AS r) x;
SELECT pg_temp.ok('10e. volver a borrador: no', r LIKE '23001 La factura C18-5 ya está registrada: no vuelve a borrador.%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET estado = ''borrador'' WHERE id = %L', pg_temp.id('c5'))) AS r) x;
SELECT pg_temp.ok('10f. borrarla: no', r LIKE '23001 La factura C18-5 ya está registrada y no se borra%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'DELETE FROM public.textil_compras WHERE id = %L', pg_temp.id('c5'))) AS r) x;
SELECT pg_temp.ok('10g. borrado lógico de una textil: no', r LIKE '23001 La compra textil C18-5 movió stock%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET borrada_en = now() WHERE id = %L', pg_temp.id('c5'))) AS r) x;
DO $$
DECLARE v JSONB;
BEGIN
  v := pg_temp.reg(pg_temp.compra('C18-10', 'Gestoría C18', 'B18000010', 10,
         jsonb_build_array(pg_temp.otra('otro', 'Honorarios', 10)), '{"categoria": "otros"}'::JSONB));
  PERFORM pg_temp.guarda('c10', (v ->> 'id')::UUID);
END $$;
SELECT pg_temp.ok('10h. cambiar el tipo de IVA sin cambiar la cuota (10 × 21,04 % = 2,10): sí', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET tipo_iva = 0.2104 WHERE id = %L', pg_temp.id('c10'))) AS r) x;
SELECT pg_temp.ok('10i. cambiar el tipo de IVA y con él la cuota: no', r LIKE '23001%«cuota_iva»%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET tipo_iva = 0.10 WHERE id = %L', pg_temp.id('c10'))) AS r) x;
SELECT pg_temp.ok('10j. borrado lógico de una «otros» registrada: sí', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET borrada_en = now() WHERE id = %L', pg_temp.id('c10'))) AS r) x;
SELECT pg_temp.ok('10k. y una borrada no vuelve a contar', r LIKE '23001 Una factura borrada no vuelve a contar.%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_compras SET borrada_en = NULL WHERE id = %L', pg_temp.id('c10'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 11. La memoria cuenta facturas y cambia de variante si la persona la cambia
-- ---------------------------------------------------------------------------
SELECT pg_temp.reg(pg_temp.compra('C18-11a', 'Mayorista C18', 'B18000008', 10, jsonb_build_array(
  pg_temp.art('Heavy Cotton negra M', 1, 10, 10, pg_temp.id('v8m'), 1,
              '{"referencia": "5000", "color": "Negro", "talla": "M", "casado_metodo": "memoria"}'::JSONB))))
  IS NOT NULL AS registrada_11a;
SELECT pg_temp.ok('11a. otra factura, misma referencia, color y talla, a la misma variante: veces = 2',
                  veces = 2 AND stock_id = pg_temp.id('v8m'), veces::TEXT)
FROM public.textil_referencias_proveedor
WHERE proveedor_id = pg_temp.id('p8') AND clave = 'r:5000|negro|M';
SELECT pg_temp.reg(pg_temp.compra('C18-11b', 'Mayorista C18', 'B18000008', 10, jsonb_build_array(
  pg_temp.art('Heavy Cotton negra M', 1, 10, 10, pg_temp.id('v8l'), 1,
              '{"referencia": "5000", "color": "Negro", "talla": "M"}'::JSONB))))
  IS NOT NULL AS registrada_11b;
SELECT pg_temp.ok('11b. la misma clave a otra variante: cambia la variante y vuelve a veces = 1',
                  veces = 1 AND stock_id = pg_temp.id('v8l'), veces::TEXT)
FROM public.textil_referencias_proveedor
WHERE proveedor_id = pg_temp.id('p8') AND clave = 'r:5000|negro|M';

-- ---------------------------------------------------------------------------
-- 12. El coste medio solo lo escribe el libro
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('12a. escribir el coste medio a mano: E-STK-1', r LIKE '23001 El coste medio no se escribe a mano%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_stock SET coste_unitario = 99 WHERE id = %L', pg_temp.id('v5a'))) AS r) x;
SELECT pg_temp.ok('12b. renombrar la variante: sí', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'UPDATE public.textil_stock SET nombre = ''Camiseta C18 cinco (renombrada)'' WHERE id = %L',
  pg_temp.id('v5a'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 13. Una compra a coste 0 baja la media
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v13', 'Camiseta C18 trece', 'Gris', 'M', 10, 5);
SELECT pg_temp.reg(pg_temp.compra('C18-13', 'Regalos C18', 'B18000013', 0, jsonb_build_array(
  pg_temp.art('Camiseta de regalo', 10, 10, 0, pg_temp.id('v13')),
  pg_temp.otra('descuento', 'Regalo', -10)))) IS NOT NULL AS registrada_13;
SELECT pg_temp.ok('13. 10 a 5,00 más 10 regaladas: coste medio 2,50', coste_unitario = 2.5 AND cantidad = 20,
                  cantidad || ' a ' || coste_unitario)
FROM public.textil_stock WHERE id = pg_temp.id('v13');

-- ---------------------------------------------------------------------------
-- 14. La devolución de un cliente vuelve al coste al que salió
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v14', 'Camiseta C18 catorce', 'Gris', 'M', 10, 4);
INSERT INTO public.textil_pedidos (numero, estado) VALUES ('C18-P14', 'pendiente');
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, textil_pedido_id)
SELECT pg_temp.empresa(), pg_temp.id('v14'), 'venta', -2, id FROM public.textil_pedidos WHERE numero = 'C18-P14';
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario)
VALUES (pg_temp.empresa(), pg_temp.id('v14'), 'inicial', 10, 10);
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, textil_pedido_id)
SELECT pg_temp.empresa(), pg_temp.id('v14'), 'devolucion_cliente', 1, id FROM public.textil_pedidos WHERE numero = 'C18-P14';
SELECT pg_temp.ok('14. vuelve 1 del pedido: entra a 4,00 (ni a 0 ni a la media)', coste_unitario = 4,
                  coste_unitario::TEXT)
FROM public.textil_stock_movimientos
WHERE stock_id = pg_temp.id('v14') AND motivo = 'devolucion_cliente';

-- ---------------------------------------------------------------------------
-- 15. Lo que aparece en un recuento entra al coste medio
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v15', 'Camiseta C18 quince', 'Gris', 'M', 10, 3);
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad)
VALUES (pg_temp.empresa(), pg_temp.id('v15'), 'ajuste_inventario', 2);
SELECT pg_temp.ok('15. un ajuste de +2 sin coste entra a 3,00 y la media no cambia',
                  m.coste_unitario = 3 AND s.coste_unitario = 3 AND s.cantidad = 12,
                  m.coste_unitario || ' / ' || s.coste_unitario)
FROM public.textil_stock_movimientos m JOIN public.textil_stock s ON s.id = m.stock_id
WHERE m.stock_id = pg_temp.id('v15') AND m.motivo = 'ajuste_inventario';

-- ---------------------------------------------------------------------------
-- 16. Una entrada «compra» sin su factura no entra
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('16a. entrada manual «compra» sin línea de factura: no', r LIKE '23514 [stock_compra_con_factura]%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario) VALUES (%L, %L, ''compra'', 5, 2)',
  pg_temp.empresa(), pg_temp.id('v15'))) AS r) x;
SELECT pg_temp.ok('16b. entrada «inicial»: sí', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario) VALUES (%L, %L, ''inicial'', 5, 3)',
  pg_temp.empresa(), pg_temp.id('v15'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 17. Coste congelado en las líneas de presupuesto
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v17', 'Camiseta C18 diecisiete', 'Gris', 'M', 1, 7.5);
SELECT pg_temp.variante('v17b', 'Camiseta C18 diecisiete', 'Gris', 'L');
INSERT INTO public.textil_presupuestos (numero) VALUES ('C18-PR17');
INSERT INTO public.textil_presupuesto_items (presupuesto_id, stock_id, descripcion, cantidad, precio_unitario)
SELECT id, pg_temp.id('v17'), 'Con coste', 2, 15 FROM public.textil_presupuestos WHERE numero = 'C18-PR17';
INSERT INTO public.textil_presupuesto_items (presupuesto_id, stock_id, descripcion, cantidad, precio_unitario)
SELECT id, pg_temp.id('v17b'), 'Sin coste', 2, 15 FROM public.textil_presupuestos WHERE numero = 'C18-PR17';
SELECT pg_temp.ok('17a. la línea congela el coste de su variante: 7,50', coste_unit_snapshot = 7.5,
                  COALESCE(coste_unit_snapshot::TEXT, 'nulo'))
FROM public.textil_presupuesto_items WHERE descripcion = 'Con coste' AND stock_id = pg_temp.id('v17');
SELECT pg_temp.ok('17b. variante sin coste: la línea queda sin coste (nulo, no 0)', coste_unit_snapshot IS NULL,
                  COALESCE(coste_unit_snapshot::TEXT, 'nulo'))
FROM public.textil_presupuesto_items WHERE descripcion = 'Sin coste' AND stock_id = pg_temp.id('v17b');
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario)
VALUES (pg_temp.empresa(), pg_temp.id('v17'), 'inicial', 1, 20);
UPDATE public.textil_presupuesto_items SET cantidad = 3 WHERE descripcion = 'Con coste' AND stock_id = pg_temp.id('v17');
SELECT pg_temp.ok('17c. cambiar la cantidad conserva 7,50 aunque la media sea ya 13,75',
                  i.coste_unit_snapshot = 7.5 AND s.coste_unitario = 13.75,
                  i.coste_unit_snapshot || ' / ' || s.coste_unitario)
FROM public.textil_presupuesto_items i JOIN public.textil_stock s ON s.id = i.stock_id
WHERE i.descripcion = 'Con coste' AND i.stock_id = pg_temp.id('v17');

-- ---------------------------------------------------------------------------
-- 18. Migración de datos: el stock de antes pasa a productos
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_stock ALTER COLUMN producto_id DROP NOT NULL;
DROP INDEX public.textil_stock_variante_unica;
DROP TRIGGER textil_stock_producto_auto ON public.textil_stock;
INSERT INTO public.textil_stock (nombre, color, talla) VALUES
  ('Polo Piqué C18', 'azul', 'M'),
  ('polo pique c18', 'Azul', 'm'),
  ('POLO PIQUE C18', 'azul', 'L');
DO $$
DECLARE v JSONB;
BEGIN
  v := public.escaner_textil_migrar_datos();
  RAISE NOTICE '%', pg_temp.ok('18a. la migración crea el producto y enlaza las tres variantes',
    (v ->> 'productos')::INT >= 1 AND (v ->> 'variantes_enlazadas')::INT = 3
    AND (v ->> 'repetidas')::INT = 1, v::TEXT);
END $$;
SELECT pg_temp.ok('18b. un producto («polo pique c18», origen migración) con tres variantes, una repetida',
                  count(DISTINCT s.producto_id) = 1 AND count(*) = 3
                  AND count(*) FILTER (WHERE s.repetida) = 1
                  AND bool_and(p.origen = 'migracion' AND p.nombre_clave = 'polopiquec18'
                               AND p.marca IS NULL AND p.referencia IS NULL),
                  count(DISTINCT s.producto_id) || ' / ' || count(*) FILTER (WHERE s.repetida))
FROM public.textil_stock s JOIN public.textil_productos p ON p.id = s.producto_id
WHERE public.textil_clave(s.nombre) = 'polopiquec18';
SELECT pg_temp.guarda('v18bueno', id) FROM public.textil_stock
 WHERE public.textil_clave(nombre) = 'polopiquec18' AND talla_clave = 'M' AND NOT repetida;
SELECT pg_temp.guarda('v18rep', id) FROM public.textil_stock
 WHERE public.textil_clave(nombre) = 'polopiquec18' AND talla_clave = 'M' AND repetida;
SET client_min_messages = warning;
\ir ../migrations/20261028100200_escaner_textil_reglas.sql
RESET client_min_messages;
SELECT pg_temp.ok('18c. la migración de reglas se vuelve a aplicar: NOT NULL, índice y trigger de vuelta',
                  (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.textil_stock'::regclass
                                                          AND attname = 'producto_id')
                  AND to_regclass('public.textil_stock_variante_unica') IS NOT NULL
                  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'textil_stock_producto_auto'));
SELECT pg_temp.ok('18d. otra llamada no hace nada: idempotente',
                  v = '{"memoria": 0, "productos": 0, "repetidas": 0, "proveedores": 0, "compras_enlazadas": 0, "variantes_enlazadas": 0}'::JSONB,
                  v::TEXT)
FROM (SELECT public.escaner_textil_migrar_datos() AS v) x;

-- ---------------------------------------------------------------------------
-- 19. Fusionar la repetida en la buena
-- ---------------------------------------------------------------------------
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario)
VALUES (pg_temp.empresa(), pg_temp.id('v18rep'), 'inicial', 3, 2),
       (pg_temp.empresa(), pg_temp.id('v18bueno'), 'inicial', 5, 4);
INSERT INTO public.textil_pedidos (numero, estado) VALUES ('C18-P19', 'pendiente');
INSERT INTO public.textil_stock_reservas (empresa_id, stock_id, textil_pedido_id, cantidad)
SELECT pg_temp.empresa(), pg_temp.id('v18rep'), id, 1 FROM public.textil_pedidos WHERE numero = 'C18-P19';
INSERT INTO public.textil_pedido_items (pedido_id, stock_id, descripcion, cantidad, precio_unitario)
SELECT id, pg_temp.id('v18rep'), 'Polo de la repetida', 1, 12 FROM public.textil_pedidos WHERE numero = 'C18-P19';
SELECT pg_temp.ok('19a. la fusión mueve 3 unidades, 1 reserva y 1 línea',
                  v = '{"unidades": 3, "reservas": 1, "lineas": 1}'::JSONB, v::TEXT)
FROM (SELECT public.textil_stock_fusionar(pg_temp.id('v18rep'), pg_temp.id('v18bueno'), pg_temp.adm()) AS v) x;
SELECT pg_temp.ok('19b. el origen queda a 0, desactivado y apuntando al destino',
                  cantidad = 0 AND NOT activa AND NOT repetida AND fusionada_en = pg_temp.id('v18bueno')
                  AND cantidad_reservada = 0)
FROM public.textil_stock WHERE id = pg_temp.id('v18rep');
SELECT pg_temp.ok('19c. el destino suma 3 (8 a 3,25) y la reserva',
                  cantidad = 8 AND coste_unitario = 3.25 AND cantidad_reservada = 1,
                  cantidad || ' a ' || coste_unitario || ', reservado ' || cantidad_reservada)
FROM public.textil_stock WHERE id = pg_temp.id('v18bueno');
SELECT pg_temp.ok('19d. la línea del pedido apunta al destino',
                  stock_id = pg_temp.id('v18bueno'))
FROM public.textil_pedido_items WHERE descripcion = 'Polo de la repetida';
SELECT pg_temp.ok('19e. los dos ajustes de la fusión suman 0 en valor',
                  sum(cantidad * coste_unitario) = 0, sum(cantidad * coste_unitario)::TEXT)
FROM public.textil_stock_movimientos
WHERE stock_id IN (pg_temp.id('v18rep'), pg_temp.id('v18bueno')) AND nota LIKE 'Fusión:%';
SELECT pg_temp.ok('19f. sin descuadres en el libro ni en las reservas',
                  NOT EXISTS (SELECT 1 FROM public.stock_descuadres())
                  AND NOT EXISTS (SELECT 1 FROM public.stock_reservas_descuadres()));
SELECT pg_temp.ok('19g. fusionar una variante consigo misma: E-FUS-1', r LIKE '22023 No se fusiona%', r)
FROM (SELECT pg_temp.fallo_sql(format('SELECT public.textil_stock_fusionar(%L, %L, %L)',
  pg_temp.id('v18bueno'), pg_temp.id('v18bueno'), pg_temp.adm())) AS r) x;
SELECT pg_temp.ok('19h. fusionar en una desactivada: E-FUS-3', r LIKE '23001 La variante de destino%', r)
FROM (SELECT pg_temp.fallo_sql(format('SELECT public.textil_stock_fusionar(%L, %L, %L)',
  pg_temp.id('v18bueno'), pg_temp.id('v18rep'), pg_temp.adm())) AS r) x;

-- ---------------------------------------------------------------------------
-- 20. textil_compra_registrar (camino viejo): packs y enlace; con porte, no
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v20', 'Camiseta C18 veinte', 'Gris', 'M');
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria)
VALUES (pg_temp.empresa(), 'Viejo C18', 'C18-20', current_date - 3, 20, 'textil');
INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad, precio_unitario, importe, stock_id, unidades_por_pack)
SELECT id, 'Pack 5 camisetas', 2, 10, 20, pg_temp.id('v20'), 5 FROM public.textil_compras WHERE numero = 'C18-20';
SELECT public.textil_compra_registrar(id) AS movidas_20 FROM public.textil_compras WHERE numero = 'C18-20';
SELECT pg_temp.ok('20a. registra: 2 packs × 5 = 10 unidades a 2,00, enlazadas a su línea',
                  c.estado = 'registrada'
                  AND (SELECT count(*) FROM public.textil_stock_movimientos m
                        WHERE m.compra_id = c.id AND m.compra_linea_id IS NOT NULL
                          AND m.cantidad = 10 AND m.coste_unitario = 2 AND m.fecha = c.fecha) = 1)
FROM public.textil_compras c WHERE c.numero = 'C18-20';
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria)
VALUES (pg_temp.empresa(), 'Viejo C18', 'C18-20b', current_date - 3, 25, 'textil');
INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad, precio_unitario, importe, stock_id, tipo)
SELECT id, 'Camisetas', 2, 10, 20, pg_temp.id('v20'), 'articulo' FROM public.textil_compras WHERE numero = 'C18-20b'
UNION ALL
SELECT id, 'Portes', 1, 5, 5, NULL, 'porte' FROM public.textil_compras WHERE numero = 'C18-20b';
SELECT pg_temp.ok('20b. con un porte: E-REG-22', r LIKE '23001 Esta compra tiene portes, descuentos u otros cargos%', r)
FROM (SELECT pg_temp.fallo_sql(format('SELECT public.textil_compra_registrar(%L)',
  (SELECT id FROM public.textil_compras WHERE numero = 'C18-20b'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 21. Una compra de consumibles por la misma función: sin stock
-- ---------------------------------------------------------------------------
DO $$
DECLARE v JSONB; v_mov INT := (SELECT count(*) FROM public.textil_stock_movimientos);
BEGIN
  v := pg_temp.reg(pg_temp.compra('C18-21', 'Tintas C18', 'B18000021', 50,
         jsonb_build_array(pg_temp.otra('otro', 'Tinta blanca', 50)), '{"categoria": "consumibles"}'::JSONB));
  RAISE NOTICE '%', pg_temp.ok('21. consumibles: registrada, 0 movimientos, proveedor enlazado',
    (v ->> 'movidas')::INT = 0
    AND (SELECT count(*) FROM public.textil_stock_movimientos) = v_mov
    AND (SELECT estado = 'registrada' AND proveedor_id = (v ->> 'proveedor_id')::UUID
           FROM public.textil_compras WHERE id = (v ->> 'id')::UUID), v::TEXT);
END $$;

-- ---------------------------------------------------------------------------
-- 22. Auditoría de las tablas nuevas y FK a empresas sin cascada
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('22a. ' || t || ': un solo trigger de auditoría, AFTER INSERT/UPDATE/DELETE por fila',
                  (SELECT count(*) FROM pg_trigger g
                    WHERE g.tgrelid = ('public.' || t)::regclass AND NOT g.tgisinternal
                      AND g.tgfoid = 'public.auditoria_registrar()'::regprocedure) = 1
                  AND EXISTS (SELECT 1 FROM pg_trigger g
                               WHERE g.tgrelid = ('public.' || t)::regclass
                                 AND g.tgname = t || '_auditoria' AND g.tgtype & 127 = 29))
FROM unnest(ARRAY['proveedores', 'textil_productos', 'textil_referencias_proveedor']) AS t;
SELECT pg_temp.ok('22b. ninguna FK a empresas en cascada', count(*) = 0, string_agg(rel.relname, ', '))
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_class ref ON ref.oid = con.confrelid
WHERE ref.relname = 'empresas' AND con.contype = 'f' AND con.confdeltype = 'c';
SELECT pg_temp.ok('22c. RLS activa y cuatro políticas por operación en las tablas nuevas',
                  count(*) = 12 AND count(*) FILTER (WHERE cmd = 'ALL') = 0
                  AND bool_and(c.relrowsecurity), count(*)::TEXT)
FROM pg_policies p JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = 'public'::regnamespace
WHERE p.schemaname = 'public'
  AND p.tablename IN ('proveedores', 'textil_productos', 'textil_referencias_proveedor');

-- ---------------------------------------------------------------------------
-- 23. Versión
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('23. escaner_textil_version() = 1', public.escaner_textil_version() = 1);

-- ---------------------------------------------------------------------------
-- 25. Registrar a mano, no; por su función, sí
-- ---------------------------------------------------------------------------
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria)
VALUES (pg_temp.empresa(), 'Mano C18', 'C18-25', current_date - 3, 10, 'textil');
INSERT INTO public.textil_compra_lineas (compra_id, descripcion, cantidad, precio_unitario, importe, stock_id)
SELECT id, 'Camiseta', 1, 10, 10, pg_temp.id('v20') FROM public.textil_compras WHERE numero = 'C18-25';
SELECT pg_temp.ok('25a. authenticated pone «registrada» con un UPDATE: E-CAB-6', r LIKE 'error 23001 Una compra se registra desde su revisión%', r)
FROM (SELECT pg_temp.como(pg_temp.adm(),
  'UPDATE public.textil_compras SET estado = ''registrada'' WHERE numero = ''C18-25''') AS r) x;
SELECT pg_temp.ok('25b. la misma, con textil_compra_registrar: sí', r = '1', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format('SELECT public.textil_compra_registrar(%L)',
  (SELECT id FROM public.textil_compras WHERE numero = 'C18-25'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 26. Entradas «compra» a mano
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('26a. authenticated anota una entrada «compra» de una línea ya registrada: E-STK-2',
                  r LIKE 'error 23001 Las entradas por compra solo las anota el registro%', r)
FROM (SELECT pg_temp.como(pg_temp.adm(), format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, compra_linea_id) VALUES (%L, %L, ''compra'', 6, 10.5, %L, %L)',
  pg_temp.empresa(), pg_temp.id('v5a'), pg_temp.id('c5'),
  (SELECT id FROM public.textil_compra_lineas WHERE compra_id = pg_temp.id('c5') AND orden = 0))) AS r) x;
SELECT pg_temp.ok('26b. una línea sin su compra (FK compuesta saltada): stock_linea_con_compra',
                  r LIKE '23514 [stock_linea_con_compra]%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_linea_id) VALUES (%L, %L, ''compra'', 6, 10.5, %L)',
  pg_temp.empresa(), pg_temp.id('v5a'),
  (SELECT id FROM public.textil_compra_lineas WHERE compra_id = pg_temp.id('c5') AND orden = 0))) AS r) x;
SELECT pg_temp.ok('26c. una línea de otra compra: la FK compuesta no la deja', r LIKE '23503%', r)
FROM (SELECT pg_temp.fallo_sql(format(
  'INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, compra_linea_id) VALUES (%L, %L, ''compra'', 6, 10.5, %L, %L)',
  pg_temp.empresa(), pg_temp.id('v5a'), pg_temp.id('c8'),
  (SELECT id FROM public.textil_compra_lineas WHERE compra_id = pg_temp.id('c5') AND orden = 0))) AS r) x;

-- ---------------------------------------------------------------------------
-- 27. Gasto fijo: borrarlo deja la factura sin enlace; cambiarlo, no
-- ---------------------------------------------------------------------------
INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde)
VALUES ('Alquiler C18', 100, current_date - 30), ('Otro gasto C18', 50, current_date - 30);
DO $$
DECLARE v JSONB;
BEGIN
  v := pg_temp.reg(pg_temp.compra('C18-27', 'Casero C18', 'B18000027', 100,
         jsonb_build_array(pg_temp.otra('otro', 'Alquiler', 100)),
         jsonb_build_object('categoria', 'servicios', 'gasto_id',
           (SELECT id FROM public.gerencia_gastos_fijos WHERE concepto = 'Alquiler C18'))));
  PERFORM pg_temp.guarda('c27', (v ->> 'id')::UUID);
END $$;
SELECT pg_temp.guarda('r27', CASE WHEN (SELECT gasto_id FROM public.textil_compras WHERE id = pg_temp.id('c27')) IS NOT NULL
                                  THEN pg_temp.id('c27') END);
SELECT pg_temp.ok('27a. borrar el gasto fijo: se puede', r = 'sin error', r)
FROM (SELECT pg_temp.fallo_sql('DELETE FROM public.gerencia_gastos_fijos WHERE concepto = ''Alquiler C18''') AS r) x;
SELECT pg_temp.ok('27b. y la factura registrada (que estaba enlazada) se queda sin enlace',
                  pg_temp.id('r27') IS NOT NULL AND gasto_id IS NULL)
FROM public.textil_compras WHERE id = pg_temp.id('c27');
SELECT pg_temp.ok('27c. enlazarla a otro gasto: E-CAB-3', r LIKE '23001%«gasto_id»%', r)
FROM (SELECT pg_temp.fallo_sql(format('UPDATE public.textil_compras SET gasto_id = %L WHERE id = %L',
  (SELECT id FROM public.gerencia_gastos_fijos WHERE concepto = 'Otro gasto C18'), pg_temp.id('c27'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 28. Una salida con coste escrito sale al coste medio
-- ---------------------------------------------------------------------------
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, coste_unitario, nota)
VALUES (pg_temp.empresa(), pg_temp.id('v15'), 'merma', -1, 99, 'Merma C18');
SELECT pg_temp.ok('28. merma de 1 «a 99»: sale al coste medio (3,00)', m.coste_unitario = 3,
                  m.coste_unitario::TEXT)
FROM public.textil_stock_movimientos m WHERE m.nota = 'Merma C18';

-- ---------------------------------------------------------------------------
-- 29. Devolución de un pedido después de fusionar la variante de la que salió
-- ---------------------------------------------------------------------------
SELECT pg_temp.variante('v29a', 'Camiseta C18 veintinueve', 'Gris', 'M', 10, 4);
SELECT pg_temp.variante('v29b', 'Camiseta C18 veintinueve bis', 'Gris', 'M', 10, 9);
INSERT INTO public.textil_pedidos (numero, estado) VALUES ('C18-P29', 'pendiente');
INSERT INTO public.textil_pedido_items (pedido_id, stock_id, descripcion, cantidad, precio_unitario)
SELECT id, pg_temp.id('v29a'), 'Camiseta del pedido 29', 2, 12 FROM public.textil_pedidos WHERE numero = 'C18-P29';
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, textil_pedido_id)
SELECT pg_temp.empresa(), pg_temp.id('v29a'), 'venta', -2, id FROM public.textil_pedidos WHERE numero = 'C18-P29';
SELECT public.textil_stock_fusionar(pg_temp.id('v29a'), pg_temp.id('v29b'), pg_temp.adm()) IS NOT NULL AS fusionada_29;
INSERT INTO public.textil_stock_movimientos (empresa_id, stock_id, motivo, cantidad, textil_pedido_id, nota)
SELECT pg_temp.empresa(), pg_temp.id('v29b'), 'devolucion_cliente', 1, id, 'Devolución C18-29'
  FROM public.textil_pedidos WHERE numero = 'C18-P29';
SELECT pg_temp.ok('29a. la devolución entra a 4,00 (el coste de la venta), no a la media del destino',
                  coste_unitario = 4, coste_unitario::TEXT)
FROM public.textil_stock_movimientos WHERE nota = 'Devolución C18-29';
SELECT pg_temp.ok('29b. la línea del pedido pasa al destino y conserva su coste congelado (4,00)',
                  stock_id = pg_temp.id('v29b') AND coste_unit_snapshot = 4,
                  COALESCE(coste_unit_snapshot::TEXT, 'nulo'))
FROM public.textil_pedido_items WHERE descripcion = 'Camiseta del pedido 29';

-- ---------------------------------------------------------------------------
-- 30. Memoria ambigua: no se aprende (ni en el registro ni en la migración)
-- ---------------------------------------------------------------------------
INSERT INTO public.proveedores (nombre, nif) VALUES ('Ambiguo C18', 'B18000030');
SELECT pg_temp.guarda('p30', id) FROM public.proveedores WHERE nif = 'B18000030';
INSERT INTO public.textil_referencias_proveedor (proveedor_id, clave, stock_id, origen)
VALUES (pg_temp.id('p30'), 'd:camisetaheavyc18', pg_temp.id('v5a'), 'manual');
DO $$
DECLARE v JSONB;
BEGIN
  v := pg_temp.reg(pg_temp.compra('C18-30', 'Ambiguo C18', 'B18000030', 20, jsonb_build_array(
         pg_temp.art('Camiseta Heavy C18', 1, 10, 10, pg_temp.id('v5a')),
         pg_temp.art('Camiseta Heavy C18', 1, 10, 10, pg_temp.id('v5b'))),
         jsonb_build_object('proveedor_id', pg_temp.id('p30'))));
  RAISE NOTICE '%', pg_temp.ok('30a. la misma descripción a dos variantes: no se aprende y se olvida la que había',
    (v ->> 'aprendidas')::INT = 0
    AND NOT EXISTS (SELECT 1 FROM public.textil_referencias_proveedor
                     WHERE proveedor_id = pg_temp.id('p30') AND clave = 'd:camisetaheavyc18'), v::TEXT);
END $$;
SELECT public.escaner_textil_migrar_datos() IS NOT NULL AS migrada_30;
SELECT pg_temp.ok('30b. la migración de datos tampoco aprende una descripción que fue a dos variantes',
                  NOT EXISTS (SELECT 1 FROM public.textil_referencias_proveedor
                               WHERE proveedor_id = pg_temp.id('p30') AND clave = 'd:camisetaheavyc18'));

-- ---------------------------------------------------------------------------
-- 31. Fecha futura, NIF que no es el del proveedor y proveedor que llega con NIF
-- ---------------------------------------------------------------------------
SELECT pg_temp.ok('31a. fecha posterior a hoy: E-REG-23', r LIKE '22023 La fecha de la factura (%) es posterior a hoy%', r)
FROM (SELECT pg_temp.fallo(pg_temp.compra('C18-31a', 'Errores C18', 'B18000007', 10,
  jsonb_build_array(pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a'))),
  jsonb_build_object('fecha', to_char(current_date + 40, 'YYYY-MM-DD')))) AS r) x;
SELECT pg_temp.ok('31b. el proveedor elegido tiene otro NIF: E-REG-25', r LIKE '22023 El NIF de la factura (B99999999) no es el del proveedor elegido (B18000005)%', r)
FROM (SELECT pg_temp.fallo(pg_temp.compra('C18-31b', 'Textiles C18 S.L.', 'B99999999', 10,
  jsonb_build_array(pg_temp.art('Uno', 1, 10, 10, pg_temp.id('v5a'))),
  jsonb_build_object('proveedor_id', pg_temp.id('p5')))) AS r) x;
INSERT INTO public.proveedores (nombre) VALUES ('Sin NIF C18');
DO $$
DECLARE v JSONB; v_n INT := (SELECT count(*) FROM public.proveedores);
BEGIN
  v := pg_temp.reg(pg_temp.compra('C18-31c', 'SIN-NIF c18', 'B18000031', 10,
         jsonb_build_array(pg_temp.otra('otro', 'Servicio', 10)), '{"categoria": "otros"}'::JSONB));
  RAISE NOTICE '%', pg_temp.ok('31c. el proveedor que existía sin NIF se completa con el de la factura: no se crea otro',
    (SELECT count(*) FROM public.proveedores) = v_n AND NOT (v ->> 'proveedor_nuevo')::BOOLEAN
    AND (SELECT nif_clave FROM public.proveedores WHERE id = (v ->> 'proveedor_id')::UUID) = 'B18000031'
    AND (SELECT nombre FROM public.proveedores WHERE id = (v ->> 'proveedor_id')::UUID) = 'Sin NIF C18',
    v::TEXT);
END $$;

-- ---------------------------------------------------------------------------
-- 32. textil_compra_registrar solo registra compras de la empresa de quien llama
-- ---------------------------------------------------------------------------
INSERT INTO public.empresas (id, razon_social, activa)
VALUES ('c1800000-0000-4000-8000-0000000000e2', 'Otra empresa C18', false);
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, categoria)
VALUES ('c1800000-0000-4000-8000-0000000000e2', 'Ajeno C18', 'C18-32', current_date - 3, 10, 'otros');
SELECT pg_temp.ok('32. un usuario de otra empresa registra una compra ajena: E-REG-2', r LIKE 'error 42501 Sin acceso a esta empresa.%', r)
FROM (SELECT pg_temp.como('c1800000-0000-4000-8000-0000000000ab', format('SELECT public.textil_compra_registrar(%L)',
  (SELECT id FROM public.textil_compras WHERE numero = 'C18-32'))) AS r) x;

-- ---------------------------------------------------------------------------
-- 33. Dos registros seguidos que crean la misma variante nueva
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.sudadera(_numero TEXT) RETURNS JSONB LANGUAGE sql AS $$
  SELECT pg_temp.compra(_numero, 'Sudaderas C18', 'B18000033', 10, jsonb_build_array(
    pg_temp.art('Sudadera gris S', 1, 10, 10, NULL, 1, jsonb_build_object(
      'nueva_variante', jsonb_build_object('producto_id', NULL,
        'producto', jsonb_build_object('marca', NULL, 'referencia', NULL, 'nombre', 'Sudadera C18',
                                       'categoria', 'sudadera'),
        'color', 'Gris', 'talla', 'S', 'ean', NULL, 'sku', NULL, 'precio_venta', 0,
        'cantidad_minima', 0)))))
$$;
DO $$
DECLARE v1 JSONB; v2 JSONB; s1 UUID; s2 UUID;
BEGIN
  v1 := pg_temp.reg(pg_temp.sudadera('C18-33a'));
  v2 := pg_temp.reg(pg_temp.sudadera('C18-33b'));
  SELECT stock_id INTO s1 FROM public.textil_compra_lineas WHERE compra_id = (v1 ->> 'id')::UUID;
  SELECT stock_id INTO s2 FROM public.textil_compra_lineas WHERE compra_id = (v2 ->> 'id')::UUID;
  RAISE NOTICE '%', pg_temp.ok('33. la segunda reutiliza la variante que creó la primera',
    (v1 ->> 'variantes_creadas')::INT = 1 AND (v2 ->> 'variantes_creadas')::INT = 0 AND s1 = s2
    AND (SELECT cantidad FROM public.textil_stock WHERE id = s1) = 2,
    v1::TEXT || ' / ' || v2::TEXT);
END $$;

-- El libro y las reservas siguen cuadrando después de todo lo anterior.
SELECT pg_temp.ok('fin. sin descuadres entre la caché y el libro ni en las reservas',
                  NOT EXISTS (SELECT 1 FROM public.stock_descuadres())
                  AND NOT EXISTS (SELECT 1 FROM public.stock_reservas_descuadres()));

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 24. Reversión y vuelta a aplicar (fuera de la transacción: las reversiones
--     llevan su BEGIN … COMMIT). La base queda como tras aplicar todas las
--     migraciones, con la versión nueva de textil_compra_registrar.
-- ---------------------------------------------------------------------------
SET client_min_messages = warning;
\ir ../reversiones/20261028100200_escaner_textil_reglas.sql
\ir ../reversiones/20261028100100_escaner_textil_datos.sql
\ir ../reversiones/20261028100000_escaner_textil_esquema.sql
RESET client_min_messages;
SELECT CASE WHEN to_regclass('public.proveedores') IS NULL
             AND to_regclass('public.textil_productos') IS NULL
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public'
                                AND (table_name, column_name) IN (('textil_stock', 'producto_id'),
                                                                  ('textil_stock_movimientos', 'compra_linea_id'),
                                                                  ('textil_compra_lineas', 'tipo')))
             AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('escaner_textil_version', 'textil_clave'))
            THEN 'BIEN  24a. las tres reversiones quitan tablas, columnas y funciones'
            ELSE 'MAL   24a. la reversión dejó algo' END;
SET client_min_messages = warning;
\ir ../migrations/20261028100000_escaner_textil_esquema.sql
\ir ../migrations/20261028100100_escaner_textil_datos.sql
\ir ../migrations/20261028100200_escaner_textil_reglas.sql
RESET client_min_messages;
SELECT CASE WHEN public.escaner_textil_version() = 1
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'textil_stock'
                            AND column_name = 'producto_id' AND is_nullable = 'NO')
             AND NOT EXISTS (SELECT 1 FROM public.textil_stock WHERE producto_id IS NULL)
             AND (SELECT prosrc LIKE '%portes, descuentos u otros cargos%' FROM pg_proc
                   WHERE proname = 'textil_compra_registrar')
            THEN 'BIEN  24b. y se vuelven a aplicar: columnas de vuelta, versión 1 y textil_compra_registrar nueva'
            ELSE 'MAL   24b. tras volver a aplicarlas no está todo' END;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.stock_descuadres())
            THEN 'BIEN  24c. el libro de stock sigue cuadrando tras revertir y volver a aplicar'
            ELSE 'MAL   24c. descuadres en el libro de stock' END;
