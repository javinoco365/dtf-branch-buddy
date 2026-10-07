-- ============================================================================
-- Ajustes de Gerencia: gastos fijos, objetivos y web sin pagar
-- ============================================================================
-- Prueba 20261008100000_gerencia_ajustes.sql: las reglas viven en la base
-- (importes positivos, fechas en orden, objetivos el día 1 y uno por mes) y
-- todo cambio queda en la auditoría.

-- 1. Un gasto fijo y un objetivo normales entran, con la empresa por defecto.
INSERT INTO public.gerencia_gastos_fijos (id, concepto, importe_mensual, desde)
VALUES ('b5b5b5b5-0000-4000-8000-000000000001', 'Alquiler nave', 800, '2026-01-01');
INSERT INTO public.gerencia_objetivos (id, desde, metros, vendido)
VALUES ('b5b5b5b5-0000-4000-8000-000000000011', '2026-10-01', 2000, 15000);
SELECT CASE WHEN (SELECT empresa_id FROM public.gerencia_gastos_fijos
                   WHERE id = 'b5b5b5b5-0000-4000-8000-000000000001') = public.empresa_por_defecto()
             AND (SELECT count(*) FROM public.gerencia_objetivos) = 1
            THEN 'BIEN  1. gasto fijo y objetivo entran con la empresa por defecto'
            ELSE 'MAL   1. alta de gasto u objetivo' END;

-- 2. Lo que no tiene sentido, lo rechaza la base.
DO $$ BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde)
  VALUES ('Mal', 0, '2026-01-01');
  RAISE WARNING 'MAL   2a. un gasto de 0 € entró';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 2a. un gasto de 0 € se rechaza';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde, hasta)
  VALUES ('Mal', 10, '2026-05-01', '2026-04-30');
  RAISE WARNING 'MAL   2b. un gasto que acaba antes de empezar entró';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 2b. un gasto que acaba antes de empezar se rechaza';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde)
  VALUES ('   ', 10, '2026-05-01');
  RAISE WARNING 'MAL   2c. un gasto sin concepto entró';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 2c. un gasto sin concepto se rechaza';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_objetivos (desde, metros) VALUES ('2026-11-15', 100);
  RAISE WARNING 'MAL   2d. un objetivo a mitad de mes entró';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 2d. un objetivo tiene que empezar el día 1';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_objetivos (desde) VALUES ('2026-11-01');
  RAISE WARNING 'MAL   2e. un objetivo vacío entró';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 2e. un objetivo sin metros ni ventas se rechaza';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_objetivos (desde, metros) VALUES ('2026-10-01', 100);
  RAISE WARNING 'MAL   2f. dos objetivos para el mismo mes entraron';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'BIEN 2f. un solo objetivo por mes';
END $$;

-- 3. Los ajustes generales: uno por empresa, con el valor de siempre por defecto.
INSERT INTO public.gerencia_ajustes (empresa_id) VALUES (public.empresa_por_defecto());
SELECT CASE WHEN web_sin_pagar_cuenta
            THEN 'BIEN  3. por defecto los pedidos web sin pagar cuentan, como hasta hoy'
            ELSE 'MAL   3. el valor por defecto cambió el comportamiento' END
FROM public.gerencia_ajustes WHERE empresa_id = public.empresa_por_defecto();

-- 4. Dar de baja un gasto (ponerle fin) y cambiar un ajuste quedan en la auditoría.
UPDATE public.gerencia_gastos_fijos SET hasta = '2026-06-30'
 WHERE id = 'b5b5b5b5-0000-4000-8000-000000000001';
UPDATE public.gerencia_ajustes SET web_sin_pagar_cuenta = false
 WHERE empresa_id = public.empresa_por_defecto();
SELECT CASE WHEN count(*) FILTER (WHERE tabla = 'gerencia_gastos_fijos') >= 2
             AND count(*) FILTER (WHERE tabla = 'gerencia_objetivos') >= 1
             AND count(*) FILTER (WHERE tabla = 'gerencia_ajustes') >= 2
            THEN 'BIEN  4. altas, bajas y cambios de los ajustes quedan en la auditoria'
            ELSE 'MAL   4. auditoria de ajustes: ' || count(*) || ' fila(s)' END
FROM public.auditoria
WHERE tabla IN ('gerencia_gastos_fijos', 'gerencia_objetivos', 'gerencia_ajustes');

-- 5. Las tres tablas tienen RLS y ninguna política FOR ALL.
SELECT CASE WHEN bool_and(c.relrowsecurity)
             AND NOT EXISTS (
               SELECT 1 FROM pg_policies p
                WHERE p.tablename IN ('gerencia_ajustes', 'gerencia_gastos_fijos', 'gerencia_objetivos')
                  AND p.cmd = 'ALL')
            THEN 'BIEN  5. RLS activa y una politica por operacion, ninguna FOR ALL'
            ELSE 'MAL   5. RLS o politicas de los ajustes' END
FROM pg_class c
WHERE c.relname IN ('gerencia_ajustes', 'gerencia_gastos_fijos', 'gerencia_objetivos');

-- 6. Aplicarla otra vez no rompe nada ni toca los datos.
\ir ../migrations/20261008100000_gerencia_ajustes.sql
SELECT CASE WHEN (SELECT count(*) FROM public.gerencia_gastos_fijos) = 1
             AND (SELECT count(*) FROM public.gerencia_objetivos) = 1
            THEN 'BIEN  6. aplicarla dos veces no cambia nada'
            ELSE 'MAL   6. tras reaplicar cambian los datos' END;
