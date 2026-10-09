-- ============================================================================
-- El número de factura es único por tienda, serie y ejercicio
-- ============================================================================
-- Prueba 20261022100000_facturas_numero_por_ejercicio.sql.
--
-- 0. Antes de volver a aplicarla, se deja la tabla como podría estar en
--    producción: sin la restricción nueva y con la vieja bajo otro nombre y con
--    las columnas en otro orden. La migración tiene que encontrarla por sus
--    columnas. Después se aplica dos veces (tiene que poder repetirse).
DO $$
BEGIN
  ALTER TABLE public.facturas DROP CONSTRAINT IF EXISTS facturas_tienda_id_serie_ejercicio_numero_key;
  ALTER TABLE public.facturas
    ADD CONSTRAINT facturas_vieja_con_otro_nombre UNIQUE (numero, serie, tienda_id);
END $$;

\ir ../migrations/20261022100000_facturas_numero_por_ejercicio.sql
\ir ../migrations/20261022100000_facturas_numero_por_ejercicio.sql

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

CREATE OR REPLACE FUNCTION pg_temp.columnas_unicas(_tabla REGCLASS)
RETURNS TABLE (nombre TEXT, columnas TEXT[]) LANGUAGE sql AS $$
  SELECT c.conname::TEXT,
         (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
            FROM pg_attribute a
           WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
    FROM pg_constraint c
   WHERE c.conrelid = _tabla AND c.contype = 'u'
$$;

CREATE OR REPLACE FUNCTION pg_temp.emitir(_tienda UUID, _fecha DATE)
RETURNS UUID LANGUAGE sql AS $$
  SELECT (public.emitir_factura(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _tienda_id  => _tienda,
    _receptor   => '{"nombre":"Cliente C10","nif":"12345678Z"}'::jsonb,
    _lineas     => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha      => _fecha,
    _simplificada => true) ->> 'id')::UUID
$$;

-- 1. La vieja ya no está, se llamara como se llamara.
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_temp.columnas_unicas('public.facturas')
                              WHERE columnas = ARRAY['numero', 'serie', 'tienda_id'])
            THEN 'BIEN  1. ya no hay restricción única sobre (tienda_id, serie, numero), tampoco con otro nombre'
            ELSE 'MAL   1. sigue la restricción vieja: '
                 || (SELECT string_agg(nombre, ', ') FROM pg_temp.columnas_unicas('public.facturas')
                      WHERE columnas = ARRAY['numero', 'serie', 'tienda_id']) END;

-- 2. La nueva existe, una sola vez, con su nombre.
SELECT CASE WHEN (SELECT array_agg(nombre) FROM pg_temp.columnas_unicas('public.facturas')
                   WHERE columnas = ARRAY['ejercicio', 'numero', 'serie', 'tienda_id'])
               = ARRAY['facturas_tienda_id_serie_ejercicio_numero_key']
            THEN 'BIEN  2. existe UNIQUE (tienda_id, serie, ejercicio, numero), una sola vez'
            ELSE 'MAL   2. la restricción nueva falta o está repetida' END;

-- 3. En una tienda nueva, un ticket de 2031 y luego otro de 2030: los dos son
--    el número 1 de su año, en la misma tienda y la misma serie.
INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C10', 'tienda-c10');
SELECT set_config('prueba.tienda', (SELECT id::TEXT FROM public.tiendas WHERE slug = 'tienda-c10'), false);

DO $$
DECLARE
  v_2031 UUID;
  v_2030 UUID;
  v_filas INT;
BEGIN
  v_2031 := pg_temp.emitir(current_setting('prueba.tienda')::UUID, DATE '2031-03-15');
  v_2030 := pg_temp.emitir(current_setting('prueba.tienda')::UUID, DATE '2030-12-30');
  PERFORM set_config('prueba.t2031', v_2031::TEXT, false);

  SELECT count(*) INTO v_filas
    FROM public.facturas a
    JOIN public.facturas b ON b.id = v_2030
   WHERE a.id = v_2031
     AND a.numero = 1 AND b.numero = 1
     AND a.ejercicio = 2031 AND b.ejercicio = 2030
     AND a.serie = b.serie AND a.tienda_id = b.tienda_id;

  IF v_filas = 1 THEN
    RAISE NOTICE 'BIEN  3. el ticket 1 de 2031 y el 1 de 2030 conviven en la misma tienda y serie';
  ELSE
    RAISE WARNING 'MAL   3. no están los dos con el número 1 de su año';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   3. el segundo ticket se rechazó: %', SQLERRM;
END $$;

-- 4. Dos documentos con el mismo número, serie, ejercicio y tienda siguen sin
--    poder existir, y lo impide la restricción nueva.
DO $$
DECLARE v_restriccion TEXT;
BEGIN
  INSERT INTO public.facturas (empresa_id, tienda_id, serie, numero, ejercicio, fecha, tipo, estado, total)
  SELECT empresa_id, tienda_id, serie, numero, ejercicio, fecha, tipo, estado, total
    FROM public.facturas
   WHERE id = current_setting('prueba.t2031')::UUID;
  RAISE WARNING 'MAL   4. se ha podido meter un segundo T2031/0001 en la misma tienda';
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'facturas_tienda_id_serie_ejercicio_numero_key' THEN
      RAISE NOTICE 'BIEN  4. un segundo T2031/0001 en la misma tienda choca con la restricción nueva';
    ELSE
      RAISE WARNING 'MAL   4. lo frenó otra restricción: %', v_restriccion;
    END IF;
  WHEN OTHERS THEN
    RAISE WARNING 'MAL   4. falló por otra cosa: %', SQLERRM;
END $$;

-- 5. textil_facturas no tenía el problema: su clave única es la referencia,
--    que lleva el año dentro. Un ticket textil de 2033 y otro de 2032 son el 1
--    de su año y conviven.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_temp.columnas_unicas('public.textil_facturas')
                          WHERE columnas = ARRAY['numero'])
             AND NOT EXISTS (SELECT 1 FROM pg_temp.columnas_unicas('public.textil_facturas')
                              WHERE 'numero_serie' = ANY (columnas))
            THEN 'BIEN  5. la única clave de número del textil es la referencia (texto con el año)'
            ELSE 'MAL   5. el textil tiene otra restricción única sobre el número' END;

DO $$
DECLARE
  v_2033 JSONB;
  v_2032 JSONB;
BEGIN
  v_2033 := public.emitir_factura_textil(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _receptor     => NULL,
    _lineas       => '[{"descripcion":"Camiseta","cantidad":1,"precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha        => DATE '2033-02-01',
    _simplificada => true);
  v_2032 := public.emitir_factura_textil(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _receptor     => NULL,
    _lineas       => '[{"descripcion":"Camiseta","cantidad":1,"precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha        => DATE '2032-11-30',
    _simplificada => true);

  IF (v_2033 ->> 'numero_serie')::INT = 1 AND (v_2032 ->> 'numero_serie')::INT = 1
     AND v_2033 ->> 'numero' LIKE '%2033/0001'
     AND v_2032 ->> 'numero' LIKE '%2032/0001' THEN
    RAISE NOTICE 'BIEN  6. textil: % y % conviven', v_2033 ->> 'numero', v_2032 ->> 'numero';
  ELSE
    RAISE WARNING 'MAL   6. textil: salieron % y %', v_2033 ->> 'numero', v_2032 ->> 'numero';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   6. el segundo ticket textil se rechazó: %', SQLERRM;
END $$;
