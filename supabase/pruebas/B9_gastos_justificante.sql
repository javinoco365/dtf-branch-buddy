-- ============================================================================
-- Gastos con o sin justificante
-- ============================================================================
-- Prueba 20261012100000_gastos_justificante.sql.

-- 1. Los gastos de antes quedan con justificante.
SELECT CASE WHEN bool_and(con_justificante)
            THEN 'BIEN  1. los gastos ya apuntados siguen con justificante'
            ELSE 'MAL   1. algún gasto de antes quedó sin justificante' END
FROM public.gerencia_gastos_fijos;

-- 2. Uno sin justificante entra.
INSERT INTO public.gerencia_gastos_fijos (id, concepto, importe_mensual, desde, con_justificante)
VALUES ('b9b9b9b9-0000-4000-8000-000000000001', 'Ayuda en mano', 200, '2026-10-01', false);
SELECT CASE WHEN NOT con_justificante THEN 'BIEN  2. gasto sin justificante guardado'
            ELSE 'MAL   2. el gasto sin justificante se guardó con él' END
FROM public.gerencia_gastos_fijos WHERE id = 'b9b9b9b9-0000-4000-8000-000000000001';

-- 3. Vacío no vale: o tiene justificante o no.
DO $$ BEGIN
  UPDATE public.gerencia_gastos_fijos SET con_justificante = NULL
   WHERE id = 'b9b9b9b9-0000-4000-8000-000000000001';
  RAISE WARNING 'MAL   3. entró un justificante vacío';
EXCEPTION WHEN not_null_violation THEN
  RAISE NOTICE 'BIEN 3. el justificante no puede quedar vacío';
END $$;

-- 4. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261012100000_gastos_justificante.sql
SELECT CASE WHEN NOT (SELECT con_justificante FROM public.gerencia_gastos_fijos
                       WHERE id = 'b9b9b9b9-0000-4000-8000-000000000001')
            THEN 'BIEN  4. aplicarla dos veces no cambia los datos'
            ELSE 'MAL   4. tras reaplicar cambian los datos' END;
