-- ============================================================================
-- Facturas: el número es único por tienda, serie y EJERCICIO, no para siempre
-- ============================================================================
--
-- EL PROBLEMA
--   public.facturas nació (20260615144900, la migración inicial de Lovable)
--   con UNIQUE (tienda_id, serie, numero), sin el año. Pero la numeración es
--   correlativa por empresa, serie y ejercicio: cada 1 de enero la serie vuelve
--   a empezar por el 1. Así que el T2026/0011 y el T2027/0011 de la misma
--   tienda chocan:
--     duplicate key value violates unique constraint
--     "facturas_tienda_id_serie_numero_key"
--   Desde 20261021100000 los documentos llevan siempre la fecha del pedido, y
--   el ejercicio sale de esa fecha. Un ticket de un pedido de 2026 emitido ya
--   en 2027 puede caer en un número que la tienda ya usó en el otro año, y
--   entonces no hay forma de emitirlo.
--
--   Ninguna migración posterior la había cambiado.
--
-- QUÉ HACE
--   1. Crea UNIQUE (tienda_id, serie, ejercicio, numero), con el nombre
--      facturas_tienda_id_serie_ejercicio_numero_key, si no hay ya una
--      restricción única con esas columnas.
--   2. Quita la restricción única sobre (tienda_id, serie, numero). Se busca en
--      pg_constraint por sus columnas, no por su nombre: si en producción se
--      llama de otra forma, un DROP por nombre no haría nada.
--   3. Comprueba que no queda ningún índice único suelto sobre esas tres
--      columnas (uno creado a mano, sin restricción). Si lo hay, se para con
--      un error que lo nombra: no se borra algo que no se sabe de dónde sale.
--
--   La nueva es estrictamente más débil que la vieja: dos filas que coinciden
--   en (tienda_id, serie, ejercicio, numero) ya coincidían en (tienda_id,
--   serie, numero). Con los datos que haya, crearla no puede fallar.
--
--   No toca ninguna fila. Se puede aplicar dos veces.
--
-- QUÉ NO CAMBIA
--   Nadie usa ON CONFLICT sobre estas columnas ni el nombre de la restricción,
--   ni en SQL ni en TypeScript. El número lo sigue asignando emitir_factura()
--   bajo bloqueo en series_facturacion, que ya era por (empresa_id, serie,
--   ejercicio).
--
--   textil_facturas no tiene este problema: su clave única es numero, el texto
--   de la referencia (T2026/0011, o FAC-2026-0007 en las antiguas), y lleva el
--   año dentro.
--
-- REVERSIBLE
--   Sí, mientras no haya números repetidos entre años en una misma tienda:
--     ALTER TABLE public.facturas
--       DROP CONSTRAINT facturas_tienda_id_serie_ejercicio_numero_key,
--       ADD CONSTRAINT facturas_tienda_id_serie_numero_key
--         UNIQUE (tienda_id, serie, numero);
--   En cuanto exista, por ejemplo, el T2026/0011 y el T2027/0011 de la misma
--   tienda, volver a crear la vieja falla con «could not create unique index»,
--   y la única forma de revertir sería borrar o renumerar facturas emitidas,
--   que no se hace.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La restricción nueva, si no está ya
-- ---------------------------------------------------------------------------
-- Primero la nueva y después quitar la vieja: en ningún momento se queda la
-- tabla sin ninguna de las dos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.facturas'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
           = ARRAY['ejercicio', 'numero', 'serie', 'tienda_id']
  ) THEN
    ALTER TABLE public.facturas
      ADD CONSTRAINT facturas_tienda_id_serie_ejercicio_numero_key
      UNIQUE (tienda_id, serie, ejercicio, numero);

    COMMENT ON CONSTRAINT facturas_tienda_id_serie_ejercicio_numero_key ON public.facturas IS
      'El número es correlativo por serie y ejercicio: el T2026/0011 y el T2027/0011 de la '
      'misma tienda son documentos distintos. Sustituye a UNIQUE (tienda_id, serie, numero) '
      'desde 20261022100000.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Fuera la vieja, se llame como se llame
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_nombre TEXT;
BEGIN
  FOR v_nombre IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.facturas'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
           = ARRAY['numero', 'serie', 'tienda_id']
  LOOP
    EXECUTE format('ALTER TABLE public.facturas DROP CONSTRAINT %I', v_nombre);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Que no quede un índice único suelto con las mismas columnas
-- ---------------------------------------------------------------------------
-- Un CREATE UNIQUE INDEX hecho a mano no aparece en pg_constraint y seguiría
-- haciendo chocar el T2026/0011 con el T2027/0011. Se miran solo las columnas
-- de la clave (las de un INCLUDE no cuentan para la unicidad) y se dejan fuera
-- los índices con expresiones, que no son este.
DO $$
DECLARE v_indice TEXT;
BEGIN
  SELECT i.indexrelid::regclass::TEXT INTO v_indice
    FROM pg_index i
   WHERE i.indrelid = 'public.facturas'::regclass
     AND i.indisunique
     AND i.indexprs IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
     AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
            FROM pg_attribute a
           WHERE a.attrelid = i.indrelid
             AND a.attnum = ANY ((i.indkey::INT2[])[0:i.indnkeyatts - 1]))
         = ARRAY['numero', 'serie', 'tienda_id']
   LIMIT 1;

  IF v_indice IS NOT NULL THEN
    RAISE EXCEPTION 'Queda el índice único % sobre (tienda_id, serie, numero) en facturas. '
      'No es una restricción y esta migración no lo ha creado: revísalo a mano antes de seguir.',
      v_indice;
  END IF;
END $$;
