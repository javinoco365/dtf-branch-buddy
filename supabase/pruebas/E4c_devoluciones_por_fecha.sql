-- ============================================================================
-- Devoluciones por el día del reembolso
-- ============================================================================
-- Prueba 20261118103000_devoluciones_por_fecha.sql:
--   1. existen los dos índices por fecha;
--   2. un periodo de todas las tiendas se puede leer por índice;
--   3. un periodo de una tienda, por el de tienda y fecha.
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

SELECT CASE WHEN count(*) = 2
            THEN 'BIEN  1. pedido_devoluciones tiene sus índices por fecha'
            ELSE 'MAL   1. faltan índices por fecha en pedido_devoluciones: ' || count(*) END
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'pedido_devoluciones'
  AND indexname IN ('idx_pedido_devoluciones_fecha', 'idx_pedido_devoluciones_tienda_fecha');

-- Con pocas filas el planificador recorrería la tabla: se le pide que no lo
-- haga, para ver que el índice sirve a la consulta.
SET LOCAL enable_seqscan = off;

DO $$
DECLARE plan TEXT := '';
DECLARE fila RECORD;
BEGIN
  FOR fila IN EXECUTE
    'EXPLAIN SELECT id FROM public.pedido_devoluciones '
    'WHERE fecha >= ''2026-11-01'' AND fecha < ''2026-12-01'''
  LOOP
    plan := plan || ' ' || fila."QUERY PLAN";
  END LOOP;
  PERFORM set_config('e4c.plan_todas', plan, true);
  plan := '';
  FOR fila IN EXECUTE
    'EXPLAIN SELECT id FROM public.pedido_devoluciones '
    'WHERE tienda_id = ''00000000-0000-0000-0000-000000000001'' '
    'AND fecha >= ''2026-11-01'' AND fecha < ''2026-12-01'''
  LOOP
    plan := plan || ' ' || fila."QUERY PLAN";
  END LOOP;
  PERFORM set_config('e4c.plan_tienda', plan, true);
END $$;

SELECT CASE WHEN current_setting('e4c.plan_todas') LIKE '%idx_pedido_devoluciones%fecha%'
            THEN 'BIEN  2. un periodo de todas las tiendas se lee por el índice'
            ELSE 'MAL   2. un periodo de todas las tiendas no usa el índice:'
                 || current_setting('e4c.plan_todas') END;

SELECT CASE WHEN current_setting('e4c.plan_tienda') LIKE '%idx_pedido_devoluciones_tienda_fecha%'
            THEN 'BIEN  3. un periodo de una tienda se lee por el índice de tienda y fecha'
            ELSE 'MAL   3. un periodo de una tienda no usa su índice:'
                 || current_setting('e4c.plan_tienda') END;

ROLLBACK;
