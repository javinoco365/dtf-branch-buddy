-- ============================================================================
-- Facturas: el ejercicio es obligatorio
-- ============================================================================
--
-- EL PROBLEMA
--   facturas.ejercicio nació en 20260902130000 (motor de facturación) como
--   INTEGER sin NOT NULL:
--
--     ADD COLUMN IF NOT EXISTS ejercicio INTEGER,
--
--   Aquella migración rellenó las filas que ya existían con el año de la
--   fecha, y desde entonces emitir_factura() lo rellena siempre (lo saca de la
--   fecha del documento, que es NOT NULL). Pero la columna sigue admitiendo
--   NULL, y desde 20261022100000 la unicidad del número es
--   UNIQUE (tienda_id, serie, ejercicio, numero). En Postgres dos NULL nunca
--   son iguales, así que dos filas con el mismo número, serie y tienda y el
--   ejercicio vacío NO chocan: la restricción no las protege.
--
-- QUÉ HACE
--   Cuenta las facturas con ejercicio NULL.
--     - Si no hay ninguna, pone la columna NOT NULL.
--     - Si hay alguna, NO falla y NO la toca: avisa con un NOTICE diciendo
--       cuántas son. Rellenarlas sería modificar documentos fiscales ya
--       emitidos, y eso no lo hace una migración: hay que mirarlas antes. La
--       consulta para verlas va en el propio aviso.
--       Cuando esas facturas tengan su ejercicio, hay que ejecutar a mano
--       otra vez el SQL de este fichero (en el editor SQL o con psql): si se
--       aplicó con la CLI de Supabase, la CLI la anota como aplicada aunque
--       no ponga el NOT NULL, y no la vuelve a ejecutar.
--
--   No toca ninguna fila. Se puede aplicar dos veces: si la columna ya es
--   NOT NULL, no hace nada.
--
-- QUÉ NO CAMBIA
--   emitir_factura() ya rellena siempre el ejercicio, así que ninguna emisión
--   que funcione hoy deja de funcionar. Nada en src/ inserta en facturas: el
--   navegador no tiene INSERT sobre la tabla desde 20260902130000.
--
-- REVERSIBLE
--   Sí:
--     ALTER TABLE public.facturas ALTER COLUMN ejercicio DROP NOT NULL;
-- ============================================================================

DO $$
DECLARE
  v_sin_ejercicio BIGINT;
BEGIN
  IF (SELECT a.attnotnull
        FROM pg_attribute a
       WHERE a.attrelid = 'public.facturas'::regclass
         AND a.attname = 'ejercicio'
         AND NOT a.attisdropped) THEN
    RETURN;
  END IF;

  -- Que nadie inserte una fila sin ejercicio entre el recuento y el cambio.
  -- Es el mismo bloqueo que tomaría el ALTER TABLE; se toma antes de contar.
  LOCK TABLE public.facturas IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO v_sin_ejercicio
    FROM public.facturas
   WHERE ejercicio IS NULL;

  IF v_sin_ejercicio = 0 THEN
    ALTER TABLE public.facturas ALTER COLUMN ejercicio SET NOT NULL;

    COMMENT ON COLUMN public.facturas.ejercicio IS
      'Año de la numeración. Obligatorio desde 20261023120000: con NULL, '
      'UNIQUE (tienda_id, serie, ejercicio, numero) no protegería la fila.';
  ELSE
    RAISE NOTICE 'facturas.ejercicio se queda admitiendo NULL: hay % factura(s) sin ejercicio. '
      'No se han tocado. Revísalas con: SELECT id, serie, numero, fecha, estado FROM public.facturas '
      'WHERE ejercicio IS NULL; Cuando tengan su ejercicio, ejecuta a mano otra vez el SQL de '
      '20261023120000_facturas_ejercicio_obligatorio.sql (editor SQL o psql): si esta migración '
      'se aplicó con la CLI, la CLI ya la tiene anotada y no la repetirá.',
      v_sin_ejercicio;
  END IF;
END $$;
