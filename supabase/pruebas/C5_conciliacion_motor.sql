-- ============================================================================
-- Conciliación: compras, grupos, «revisar» y traspasos
-- ============================================================================
-- Prueba 20261017100000_conciliacion_motor.sql y su reversión. Antes de esto
-- ya ha pasado 95_conciliacion_banco.sql, que prueba que banco_conciliar y
-- banco_desconciliar siguen haciendo lo mismo de siempre.

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

CREATE TEMP TABLE c5 (caso TEXT PRIMARY KEY, id UUID);

CREATE OR REPLACE FUNCTION pg_temp.compra(_caso TEXT, _base NUMERIC, _iva NUMERIC, _irpf NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.textil_compras
    (empresa_id, proveedor, numero, fecha, base, tipo_iva, tipo_irpf, total, categoria)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'Prov C5', _caso,
          '2026-11-02', _base, _iva, _irpf, 0, 'otros')
  RETURNING id INTO v;
  PERFORM public.textil_compra_registrar(v);
  INSERT INTO c5 VALUES (_caso, v);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mov(_caso TEXT, _cuenta TEXT, _fecha DATE, _importe NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella, cuenta_id)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), _fecha, _caso, _importe,
          'c5-' || _caso, (SELECT id FROM public.banco_cuentas WHERE alias = _cuenta))
  RETURNING id INTO v;
  INSERT INTO c5 VALUES (_caso, v);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(_caso TEXT) RETURNS UUID
LANGUAGE sql AS $$ SELECT id FROM c5 WHERE caso = _caso $$;

CREATE OR REPLACE FUNCTION pg_temp.doc(_tipo TEXT, _caso TEXT) RETURNS JSONB
LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('tipo', _tipo, 'id', pg_temp.id(_caso))) $$;

INSERT INTO public.banco_cuentas (empresa_id, banco, alias)
SELECT id, 'BBVA', 'C5 principal' FROM public.empresas WHERE activa LIMIT 1;
INSERT INTO public.banco_cuentas (empresa_id, banco, alias)
SELECT id, 'Santander', 'C5 ahorro' FROM public.empresas WHERE activa LIMIT 1;

-- Alquiler: base 1.000, IVA 21 %, IRPF 19 % → líquido 1.020 (lo que sale del banco).
SELECT pg_temp.compra('alquiler', 1000, 0.21, 0.19);
SELECT pg_temp.mov('cargo-alquiler', 'C5 principal', '2026-11-05', -1020);

-- 1. Un cargo concilia con su factura recibida y la deja pagada con la fecha del banco.
SELECT set_config('prueba.g1', public.banco_enlazar(
  ARRAY[pg_temp.id('cargo-alquiler')], pg_temp.doc('compra', 'alquiler'),
  'conciliada', 'contraparte')::TEXT, false);
SELECT CASE WHEN estado_pago = 'pagada' AND fecha_pago = '2026-11-05'
            THEN 'BIEN  1. el cargo de 1.020 paga el alquiler y lo deja pagado el día del cargo'
            ELSE 'MAL   1. ' || estado_pago || ' ' || COALESCE(fecha_pago::TEXT, '-') END
FROM public.textil_compras WHERE id = pg_temp.id('alquiler');
SELECT CASE WHEN importe = -1020 AND diferencia = 0 AND estado = 'conciliada' AND marco_pagada
            THEN 'BIEN  1b. guarda el líquido esperado, diferencia 0 y que la marcó pagada'
            ELSE 'MAL   1b. ' || importe || ' / ' || diferencia END
FROM public.banco_conciliaciones WHERE grupo = current_setting('prueba.g1')::UUID;

-- 2. La misma factura no se concilia dos veces, ni el mismo movimiento.
SELECT pg_temp.mov('cargo-alquiler-2', 'C5 principal', '2026-11-06', -1020);
DO $$ BEGIN
  PERFORM public.banco_enlazar(ARRAY[pg_temp.id('cargo-alquiler-2')], pg_temp.doc('compra', 'alquiler'));
  RAISE WARNING 'MAL   2a. la misma factura recibida se concilió dos veces';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN 2a. una factura recibida no se concilia dos veces';
END $$;
SELECT pg_temp.compra('luz', 100, 0.21, 0);
DO $$ BEGIN
  PERFORM public.banco_enlazar(ARRAY[pg_temp.id('cargo-alquiler')], pg_temp.doc('compra', 'luz'));
  RAISE WARNING 'MAL   2b. el mismo movimiento se concilió dos veces';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN 2b. un movimiento no se concilia dos veces';
END $$;

-- 3. Un abono no paga una factura recibida.
SELECT pg_temp.mov('abono-121', 'C5 principal', '2026-11-05', 121);
DO $$ BEGIN
  PERFORM public.banco_enlazar(ARRAY[pg_temp.id('abono-121')], pg_temp.doc('compra', 'luz'));
  RAISE WARNING 'MAL   3. un abono pagó una factura recibida';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN  3. un abono no paga una factura recibida';
END $$;

-- 4. «Revisar» no toca nada; confirmar sí.
SELECT pg_temp.mov('cargo-luz', 'C5 principal', '2026-11-04', -121);
SELECT set_config('prueba.g4', public.banco_enlazar(
  ARRAY[pg_temp.id('cargo-luz')], pg_temp.doc('compra', 'luz'), 'revisar', 'importe_fecha')::TEXT, false);
SELECT CASE WHEN estado_pago = 'pendiente'
            THEN 'BIEN  4a. en «revisar» la factura sigue pendiente'
            ELSE 'MAL   4a. «revisar» la marcó pagada' END
FROM public.textil_compras WHERE id = pg_temp.id('luz');
-- (Cada comprobación en su sentencia: una subconsulta en la misma que la
-- función ve los datos de antes de llamarla.)
SELECT set_config('prueba.r4', public.banco_confirmar(current_setting('prueba.g4')::UUID)::TEXT, false);
SELECT CASE WHEN current_setting('prueba.r4')::BOOLEAN
             AND (SELECT estado_pago FROM public.textil_compras WHERE id = pg_temp.id('luz')) = 'pagada'
             AND (SELECT estado FROM public.banco_conciliaciones
                   WHERE grupo = current_setting('prueba.g4')::UUID) = 'conciliada'
            THEN 'BIEN  4b. al confirmar pasa a conciliada y la factura a pagada'
            ELSE 'MAL   4b. confirmar no hizo lo que debía' END;
SELECT CASE WHEN NOT public.banco_confirmar(current_setting('prueba.g4')::UUID)
            THEN 'BIEN  4c. confirmar dos veces no hace nada'
            ELSE 'MAL   4c. confirmó dos veces' END;

-- 5. Un pago que cubre dos facturas: un grupo, dos filas, las dos pagadas.
SELECT pg_temp.compra('tinta-1', 50, 0.21, 0);   -- 60,50
SELECT pg_temp.compra('tinta-2', 25, 0.21, 0);   -- 30,25
SELECT pg_temp.mov('cargo-tintas', 'C5 principal', '2026-11-10', -90.75);
SELECT set_config('prueba.g5', public.banco_enlazar(
  ARRAY[pg_temp.id('cargo-tintas')],
  pg_temp.doc('compra', 'tinta-1') || pg_temp.doc('compra', 'tinta-2'),
  'revisar', 'suma_documentos')::TEXT, false);
SELECT CASE WHEN count(*) = 2 AND sum(importe) = -90.75 AND max(diferencia) = 0
            THEN 'BIEN  5a. un cargo contra dos facturas: un grupo de dos filas que suma'
            ELSE 'MAL   5a. ' || count(*) || ' filas' END
FROM public.banco_conciliaciones WHERE grupo = current_setting('prueba.g5')::UUID;
SELECT public.banco_confirmar(current_setting('prueba.g5')::UUID);
SELECT CASE WHEN count(*) FILTER (WHERE estado_pago = 'pagada') = 2
            THEN 'BIEN  5b. confirmado, las dos facturas quedan pagadas'
            ELSE 'MAL   5b. no quedaron las dos pagadas' END
FROM public.textil_compras WHERE id IN (pg_temp.id('tinta-1'), pg_temp.id('tinta-2'));

-- 6. Una factura pagada en dos plazos.
SELECT pg_temp.compra('maquina', 1000, 0.21, 0); -- 1.210
SELECT pg_temp.mov('plazo-1', 'C5 principal', '2026-11-12', -605);
SELECT pg_temp.mov('plazo-2', 'C5 principal', '2026-11-20', -605);
SELECT set_config('prueba.g6', public.banco_enlazar(
  ARRAY[pg_temp.id('plazo-1'), pg_temp.id('plazo-2')], pg_temp.doc('compra', 'maquina'),
  'conciliada', 'manual')::TEXT, false);
SELECT CASE WHEN fecha_pago = '2026-11-20'
            THEN 'BIEN  6. dos plazos pagan una factura; la fecha de pago es la del último'
            ELSE 'MAL   6. fecha de pago ' || COALESCE(fecha_pago::TEXT, '-') END
FROM public.textil_compras WHERE id = pg_temp.id('maquina');

-- 7. Varios contra varios no se enlazan de una vez.
SELECT pg_temp.compra('c7a', 10, 0, 0);
SELECT pg_temp.compra('c7b', 10, 0, 0);
SELECT pg_temp.mov('m7a', 'C5 principal', '2026-11-12', -10);
SELECT pg_temp.mov('m7b', 'C5 principal', '2026-11-12', -10);
DO $$ BEGIN
  PERFORM public.banco_enlazar(ARRAY[pg_temp.id('m7a'), pg_temp.id('m7b')],
                               pg_temp.doc('compra', 'c7a') || pg_temp.doc('compra', 'c7b'));
  RAISE WARNING 'MAL   7. enlazó varios movimientos contra varias facturas';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN  7. varios contra varios, por partes';
END $$;

-- 8. Deshacer devuelve a pendiente solo lo que marcó.
UPDATE public.textil_compras SET estado_pago = 'pagada', fecha_pago = '2026-11-01'
 WHERE id = pg_temp.id('c7a');
SELECT set_config('prueba.g8', public.banco_enlazar(
  ARRAY[pg_temp.id('m7a')], pg_temp.doc('compra', 'c7a'))::TEXT, false);
SELECT public.banco_desenlazar(current_setting('prueba.g8')::UUID);
SELECT CASE WHEN estado_pago = 'pagada' AND fecha_pago = '2026-11-01'
            THEN 'BIEN  8a. deshacer no despaga una factura que ya estaba pagada antes'
            ELSE 'MAL   8a. ' || estado_pago END
FROM public.textil_compras WHERE id = pg_temp.id('c7a');
SELECT set_config('prueba.r8', public.banco_desenlazar(current_setting('prueba.g6')::UUID)::TEXT, false);
SELECT CASE WHEN current_setting('prueba.r8')::INT = 2
             AND (SELECT estado_pago FROM public.textil_compras WHERE id = pg_temp.id('maquina')) = 'pendiente'
             AND (SELECT fecha_pago FROM public.textil_compras WHERE id = pg_temp.id('maquina')) IS NULL
            THEN 'BIEN  8b. deshacer los dos plazos devuelve la factura a pendiente'
            ELSE 'MAL   8b. deshacer no devolvió la factura a pendiente' END;

-- 9. La tabla ya no se escribe a mano.
SET ROLE authenticated;
DO $$ BEGIN
  DELETE FROM public.banco_conciliaciones WHERE grupo = current_setting('prueba.g1')::UUID;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.banco_conciliaciones
                          WHERE grupo = current_setting('prueba.g1')::UUID)
            THEN 'BIEN  9. una conciliación se deshace por la función, no con DELETE'
            ELSE 'MAL   9. se pudo borrar una conciliación sin pasar por la función' END;

-- 10. Traspasos entre cuentas propias.
SELECT pg_temp.mov('sale', 'C5 principal', '2026-11-15', -500);
SELECT pg_temp.mov('entra', 'C5 ahorro', '2026-11-16', 500);
SELECT pg_temp.mov('entra-misma', 'C5 principal', '2026-11-16', 500);
DO $$ BEGIN
  PERFORM public.banco_marcar_traspaso(pg_temp.id('sale'), pg_temp.id('entra-misma'));
  RAISE WARNING 'MAL   10a. traspaso dentro de la misma cuenta';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN 10a. un traspaso va entre cuentas distintas';
END $$;
DO $$ BEGIN
  PERFORM public.banco_marcar_traspaso(pg_temp.id('sale'), pg_temp.id('abono-121'));
  RAISE WARNING 'MAL   10b. traspaso con importes que no son espejo';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN 10b. los importes tienen que ser espejo';
END $$;
SELECT set_config('prueba.r10', public.banco_marcar_traspaso(pg_temp.id('sale'), pg_temp.id('entra'))::TEXT, false);
SELECT CASE WHEN current_setting('prueba.r10')::BOOLEAN
             AND (SELECT traspaso_con FROM public.banco_movimientos WHERE id = pg_temp.id('entra'))
                 = pg_temp.id('sale')
            THEN 'BIEN 10c. marcado el traspaso, cada uno apunta al otro'
            ELSE 'MAL  10c. no se marcó el traspaso' END;
DO $$ BEGIN
  PERFORM public.banco_enlazar(ARRAY[pg_temp.id('sale')], pg_temp.doc('compra', 'c7b'));
  RAISE WARNING 'MAL   10d. un traspaso pagó una factura';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN 10d. un traspaso no paga facturas';
END $$;
SELECT set_config('prueba.r10e', public.banco_desmarcar_traspaso(pg_temp.id('entra'))::TEXT, false);
SELECT CASE WHEN current_setting('prueba.r10e')::BOOLEAN
             AND (SELECT count(*) FROM public.banco_movimientos
                   WHERE id IN (pg_temp.id('sale'), pg_temp.id('entra')) AND traspaso_con IS NOT NULL) = 0
            THEN 'BIEN 10e. desmarcar libera los dos'
            ELSE 'MAL  10e. desmarcar dejó alguno marcado' END;

-- 10f. Un abono se enlaza con una factura de textil, que no se toca.
DO $$
DECLARE v_tf UUID; v_mov UUID; v_estado TEXT; v_total NUMERIC;
BEGIN
  SELECT id, estado, total INTO v_tf, v_estado, v_total FROM public.textil_facturas
   WHERE estado NOT IN ('borrador', 'anulada') AND total > 0 LIMIT 1;
  IF v_tf IS NULL THEN
    RAISE NOTICE 'BIEN 10f. (sin facturas de textil en la base de pruebas: se omite)';
    RETURN;
  END IF;
  v_mov := pg_temp.mov('abono-textil', 'C5 principal', CURRENT_DATE, v_total);
  PERFORM public.banco_enlazar(ARRAY[v_mov],
    jsonb_build_array(jsonb_build_object('tipo', 'textil', 'id', v_tf)));
  IF (SELECT estado FROM public.textil_facturas WHERE id = v_tf) = v_estado
     AND EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE textil_factura_id = v_tf) THEN
    RAISE NOTICE 'BIEN 10f. el abono se enlaza con la factura de textil y esta no cambia';
  ELSE
    RAISE WARNING 'MAL  10f. la factura de textil cambió o no se enlazó';
  END IF;
  PERFORM public.banco_desenlazar(grupo) FROM public.banco_conciliaciones
   WHERE textil_factura_id = v_tf;
END $$;

-- 11. Sin usuario no se enlaza.
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  PERFORM public.banco_enlazar(ARRAY[pg_temp.id('m7b')], pg_temp.doc('compra', 'c7b'));
  RAISE WARNING 'MAL   11. se enlazó sin usuario';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BIEN 11. sin usuario no se enlaza';
END $$;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

-- 12. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261017100000_conciliacion_motor.sql
SELECT CASE WHEN (SELECT count(*) FROM public.banco_conciliaciones
                   WHERE grupo = current_setting('prueba.g5')::UUID) = 2
            THEN 'BIEN 12. aplicarla dos veces no cambia los datos'
            ELSE 'MAL  12. tras reaplicar cambian los datos' END;

-- 13. La reversión se niega mientras haya enlaces que no sabe guardar.
DO $$ BEGIN
  -- La reversión lleva su BEGIN/COMMIT; aquí se prueba solo su comprobación.
  IF EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE compra_id IS NOT NULL) THEN
    RAISE NOTICE 'BIEN 13a. hay enlaces con compras: la reversión se negaría';
  ELSE
    RAISE WARNING 'MAL  13a. no quedan enlaces con compras para probar la negativa';
  END IF;
END $$;
SELECT public.banco_desenlazar(grupo) FROM (
  SELECT DISTINCT grupo FROM public.banco_conciliaciones WHERE compra_id IS NOT NULL) g;
\ir ../reversiones/20261017100000_conciliacion_motor.sql
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name = 'banco_conciliaciones' AND column_name = 'grupo')
             AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conciliacion_factura_unica')
            THEN 'BIEN 13b. deshechos los enlaces, la reversión deja el esquema de antes'
            ELSE 'MAL  13b. la reversión no dejó el esquema de antes' END;
\ir ../migrations/20261017100000_conciliacion_motor.sql
SELECT 'BIEN 14. y se puede volver a aplicar';
