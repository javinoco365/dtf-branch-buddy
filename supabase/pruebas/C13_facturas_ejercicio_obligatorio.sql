-- ============================================================================
-- facturas.ejercicio es obligatorio
-- ============================================================================
-- Prueba 20261023120000_facturas_ejercicio_obligatorio.sql.
--
-- 0. Se deja la columna como estaba en producción (admitiendo NULL) y se
--    aplica la migración dos veces: tiene que poder repetirse.
ALTER TABLE public.facturas ALTER COLUMN ejercicio DROP NOT NULL;

\ir ../migrations/20261023120000_facturas_ejercicio_obligatorio.sql
\ir ../migrations/20261023120000_facturas_ejercicio_obligatorio.sql

CREATE OR REPLACE FUNCTION pg_temp.ejercicio_obligatorio() RETURNS BOOLEAN
LANGUAGE sql AS $$
  SELECT a.attnotnull
    FROM pg_attribute a
   WHERE a.attrelid = 'public.facturas'::regclass AND a.attname = 'ejercicio' AND NOT a.attisdropped
$$;

-- 1. Sin filas vacías, la columna queda NOT NULL.
SELECT CASE WHEN pg_temp.ejercicio_obligatorio()
            THEN 'BIEN  1. sin facturas sin ejercicio, la columna pasa a NOT NULL'
            ELSE 'MAL   1. la columna sigue admitiendo NULL' END;

-- 2. Y una factura sin ejercicio ya no entra.
DO $$
DECLARE v_tienda UUID;
BEGIN
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C13 nula', 'tienda-c13-nula') RETURNING id INTO v_tienda;
  INSERT INTO public.facturas (tienda_id, serie, numero, ejercicio, fecha, estado)
  VALUES (v_tienda, 'C13', 1, NULL, DATE '2026-10-09', 'borrador');
  RAISE WARNING 'MAL   2. ha entrado una factura sin ejercicio';
EXCEPTION
  WHEN not_null_violation THEN
    RAISE NOTICE 'BIEN  2. una factura sin ejercicio se rechaza (not_null_violation)';
  WHEN OTHERS THEN
    RAISE WARNING 'MAL   2. la rechazó otra cosa: %', SQLERRM;
END $$;

-- 3. Si hay facturas sin ejercicio, la migración avisa, no falla y no toca
--    nada. Se prueba dentro de una transacción que se deshace.
BEGIN;
ALTER TABLE public.facturas ALTER COLUMN ejercicio DROP NOT NULL;
INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C13 vieja', 'tienda-c13-vieja');
INSERT INTO public.facturas (tienda_id, serie, numero, ejercicio, fecha, estado)
SELECT t.id, 'C13', n, NULL, DATE '2026-10-09', 'borrador'
  FROM public.tiendas t CROSS JOIN generate_series(1, 2) AS n
 WHERE t.slug = 'tienda-c13-vieja';

\ir ../migrations/20261023120000_facturas_ejercicio_obligatorio.sql

SELECT CASE WHEN NOT pg_temp.ejercicio_obligatorio()
             AND (SELECT count(*) FROM public.facturas f
                    JOIN public.tiendas t ON t.id = f.tienda_id
                   WHERE t.slug = 'tienda-c13-vieja' AND f.ejercicio IS NULL) = 2
            THEN 'BIEN  3. con dos facturas sin ejercicio, la migración no falla, no pone NOT NULL y no las toca'
            ELSE 'MAL   3. con facturas sin ejercicio la migración cambió la columna o las filas' END;
ROLLBACK;

SELECT CASE WHEN pg_temp.ejercicio_obligatorio()
            THEN 'BIEN  4. deshecha la prueba anterior, la columna vuelve a ser NOT NULL'
            ELSE 'MAL   4. la columna se ha quedado admitiendo NULL' END;

-- 5. emitir_factura() sigue funcionando: siempre rellena el ejercicio.
INSERT INTO auth.users (id, email)
VALUES ('c1300000-0000-4000-8000-000000000001', 'autor@c13.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C13', 'tienda-c13');
INSERT INTO public.tienda_usuarios (tienda_id, user_id)
SELECT id, 'c1300000-0000-4000-8000-000000000001' FROM public.tiendas WHERE slug = 'tienda-c13';

DO $$
DECLARE v_factura JSONB;
BEGIN
  v_factura := public.emitir_factura(
    _usuario_id   => 'c1300000-0000-4000-8000-000000000001',
    _tienda_id    => (SELECT id FROM public.tiendas WHERE slug = 'tienda-c13'),
    _receptor     => '{"nombre":"Cliente C13","nif":"12345678Z"}'::jsonb,
    _lineas       => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha        => DATE '2037-01-15',
    _simplificada => true);

  IF (SELECT ejercicio FROM public.facturas WHERE id = (v_factura ->> 'id')::UUID) = 2037 THEN
    RAISE NOTICE 'BIEN  5. emitir_factura() sigue emitiendo, con el ejercicio de la fecha: %', v_factura ->> 'referencia';
  ELSE
    RAISE WARNING 'MAL   5. la factura emitida no lleva el ejercicio 2037';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   5. la emisión falló: %', SQLERRM;
END $$;
