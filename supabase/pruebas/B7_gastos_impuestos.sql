-- ============================================================================
-- Gastos con impuestos y periodicidad, y datos fiscales de la empresa
-- ============================================================================
-- Prueba 20261010100000_gastos_impuestos.sql.

-- 1. Los gastos de antes siguen siendo mensuales, sin IVA ni IRPF.
SELECT CASE WHEN bool_and(periodicidad = 'mensual' AND tipo = 'otros'
                          AND iva_pct = 0 AND irpf_pct = 0)
            THEN 'BIEN  1. los gastos ya apuntados se leen igual que antes'
            ELSE 'MAL   1. los gastos de antes cambiaron' END
FROM public.gerencia_gastos_fijos;

-- 2. Un alquiler trimestral con IVA e IRPF entra.
INSERT INTO public.gerencia_gastos_fijos
  (id, concepto, importe_mensual, desde, periodicidad, tipo, iva_pct, irpf_pct)
VALUES ('b7b7b7b7-0000-4000-8000-000000000001', 'Alquiler nave', 3000, '2026-10-01',
        'trimestral', 'alquiler', 21, 19);
SELECT CASE WHEN count(*) = 1 THEN 'BIEN  2. alquiler trimestral con IVA e IRPF'
            ELSE 'MAL   2. no entró el alquiler' END
FROM public.gerencia_gastos_fijos WHERE id = 'b7b7b7b7-0000-4000-8000-000000000001';

-- 3. Lo que no tiene sentido, no entra.
DO $$ BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde, periodicidad)
  VALUES ('Mal', 10, '2026-01-01', 'semanal');
  RAISE WARNING 'MAL   3a. entró una periodicidad que no existe';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 3a. periodicidad desconocida rechazada';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde, tipo)
  VALUES ('Mal', 10, '2026-01-01', 'capricho');
  RAISE WARNING 'MAL   3b. entró un tipo que no existe';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 3b. tipo desconocido rechazado';
END $$;

DO $$ BEGIN
  INSERT INTO public.gerencia_gastos_fijos (concepto, importe_mensual, desde, irpf_pct)
  VALUES ('Mal', 10, '2026-01-01', -5);
  RAISE WARNING 'MAL   3c. entró un IRPF negativo';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 3c. porcentaje negativo rechazado';
END $$;

-- 4. Los ajustes traen el 15 % de nueva creación y el metro a 7 €.
INSERT INTO public.gerencia_ajustes (empresa_id)
VALUES (public.empresa_por_defecto())
ON CONFLICT (empresa_id) DO NOTHING;
SELECT CASE WHEN tipo_is = 15 AND precio_metro = 7 AND cuota_is_anterior IS NULL
            THEN 'BIEN  4. Sociedades al 15 %, sin 202 y el metro a 7 €'
            ELSE 'MAL   4. valores por defecto: ' || tipo_is || ' / ' || precio_metro END
FROM public.gerencia_ajustes WHERE empresa_id = public.empresa_por_defecto();

DO $$ BEGIN
  UPDATE public.gerencia_ajustes SET precio_metro = 0 WHERE empresa_id = public.empresa_por_defecto();
  RAISE WARNING 'MAL   5. el metro a 0 € entró';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 5. el metro no puede valer 0';
END $$;

-- 6. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261010100000_gastos_impuestos.sql
SELECT CASE WHEN (SELECT irpf_pct FROM public.gerencia_gastos_fijos
                   WHERE id = 'b7b7b7b7-0000-4000-8000-000000000001') = 19
            THEN 'BIEN  6. aplicarla dos veces no cambia los datos'
            ELSE 'MAL   6. tras reaplicar cambian los datos' END;
