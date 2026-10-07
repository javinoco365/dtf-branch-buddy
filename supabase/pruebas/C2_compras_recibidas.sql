-- ============================================================================
-- Facturas recibidas: los importes los calcula la base
-- ============================================================================
-- Prueba 20261014100000_compras_recibidas.sql y su reversión.

CREATE TEMP TABLE c2 (caso TEXT PRIMARY KEY, id UUID);

CREATE OR REPLACE FUNCTION pg_temp.compra(_caso TEXT, _base NUMERIC, _iva NUMERIC,
                                          _irpf NUMERIC, _total NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.textil_compras
    (empresa_id, proveedor, numero, fecha, base, tipo_iva, tipo_irpf, total, categoria)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'Prov C2', _caso,
          '2026-11-15', _base, _iva, _irpf, _total, 'otros')
  RETURNING id INTO v;
  INSERT INTO c2 VALUES (_caso, v);
  RETURN v;
END $$;

-- 1. Redondeos: la base redondea a céntimos, mitad hacia arriba.
SELECT pg_temp.compra('C2-1', 33.33, 0.21, 0, 0);    -- 6,9993 → 7,00
SELECT pg_temp.compra('C2-2', 0.05, 0.21, 0, 0);     -- 0,0105 → 0,01
SELECT pg_temp.compra('C2-3', 1000, 0.21, 0.19, 0);  -- alquiler: líquido 1.020
SELECT pg_temp.compra('C2-4', 12.50, 0.21, 0.15, 0); -- 2,625 → 2,63 y 1,875 → 1,88

SELECT CASE WHEN cuota_iva = 7.00 AND total_calculado = 40.33 AND liquido = 40.33
            THEN 'BIEN  1a. 33,33 al 21 %: IVA 7,00, total 40,33'
            ELSE 'MAL   1a. ' || cuota_iva || ' / ' || total_calculado END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-1');
SELECT CASE WHEN cuota_iva = 0.01 THEN 'BIEN  1b. 0,05 al 21 %: IVA 0,01'
            ELSE 'MAL   1b. ' || cuota_iva END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-2');
SELECT CASE WHEN cuota_iva = 210 AND cuota_irpf = 190 AND total_calculado = 1210
                 AND liquido_calculado = 1020 AND liquido = 1020
            THEN 'BIEN  1c. alquiler: total 1.210, líquido 1.020'
            ELSE 'MAL   1c. ' || total_calculado || ' / ' || liquido END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-3');
SELECT CASE WHEN cuota_iva = 2.63 AND cuota_irpf = 1.88 AND liquido = 13.25
            THEN 'BIEN  1d. medios céntimos hacia arriba: 2,63 y 1,88'
            ELSE 'MAL   1d. ' || cuota_iva || ' / ' || cuota_irpf || ' / ' || liquido END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-4');
SELECT CASE WHEN ejercicio = 2026 AND trimestre = 4 THEN 'BIEN  1e. ejercicio 2026, 4.º trimestre'
            ELSE 'MAL   1e. ' || ejercicio || ' T' || trimestre END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-1');

-- 2. Nadie escribe un importe calculado: ni la aplicación.
DO $$ BEGIN
  UPDATE public.textil_compras SET liquido = 1 WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-1');
  RAISE WARNING 'MAL   2. se pudo escribir el líquido a mano';
EXCEPTION WHEN generated_always OR feature_not_supported OR syntax_error THEN
  RAISE NOTICE 'BIEN  2. el líquido no se escribe a mano';
WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  2. el líquido no se escribe a mano (%)', SQLSTATE;
END $$;

-- 3. El líquido de la factura vale solo con su nota.
DO $$ BEGIN
  UPDATE public.textil_compras SET liquido_origen = 'factura', total = 1019.99
   WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-3');
  RAISE WARNING 'MAL   3a. vale el importe de la factura sin decir por qué';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 3a. sin nota no vale el importe de la factura';
END $$;
UPDATE public.textil_compras
   SET liquido_origen = 'factura', total = 1019.99, nota_descuadre = 'El casero redondea a la baja'
 WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-3');
SELECT CASE WHEN liquido = 1019.99 AND liquido_calculado = 1020
            THEN 'BIEN  3b. con nota vale el líquido impreso (1.019,99); el calculado sigue a la vista'
            ELSE 'MAL   3b. ' || liquido END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-3');

-- 4. Pagada, con fecha.
DO $$ BEGIN
  UPDATE public.textil_compras SET estado_pago = 'pagada'
   WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-1');
  RAISE WARNING 'MAL   4a. pagada sin fecha';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 4a. pagada exige fecha de pago';
END $$;
UPDATE public.textil_compras SET estado_pago = 'pagada', fecha_pago = '2026-11-20'
 WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-1');
SELECT 'BIEN  4b. pagada con fecha';

-- 5. Tipos fuera de rango y formas de pago inventadas, no.
DO $$ BEGIN
  UPDATE public.textil_compras SET tipo_iva = 21 WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-2');
  RAISE WARNING 'MAL   5a. entró un IVA del 2.100 %%';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 5a. el tipo va en tanto por uno (21 no vale)';
END $$;
DO $$ BEGIN
  UPDATE public.textil_compras SET forma_pago = 'trueque' WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-2');
  RAISE WARNING 'MAL   5b. entró una forma de pago inventada';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 5b. forma de pago desconocida rechazada';
END $$;

-- 6. Aplicarla otra vez no cambia nada (ni pisa los tipos).
UPDATE public.textil_compras SET tipo_iva = 0.10 WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-2');
\ir ../migrations/20261014100000_compras_recibidas.sql
SELECT CASE WHEN tipo_iva = 0.10 AND cuota_iva = 0.01
            THEN 'BIEN  6. aplicarla dos veces no pisa los tipos'
            ELSE 'MAL   6. tras reaplicar: ' || tipo_iva END
FROM public.textil_compras WHERE id = (SELECT id FROM c2 WHERE caso = 'C2-2');

-- 7. La reversión deja la tabla como estaba, y al volver a aplicar, las
--    compras que hubiera toman sus tipos de sus importes.
\ir ../reversiones/20261014100000_compras_recibidas.sql
SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'textil_compras' AND column_name IN ('liquido', 'tipo_iva', 'borrada_en'))
            THEN 'BIEN  7a. la reversión quita las columnas'
            ELSE 'MAL   7a. la reversión dejó columnas' END;
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, iva, irpf, total, categoria)
VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'Gestoría C2', 'C2-7',
        '2026-10-01', 200, 42, 30, 212, 'servicios');
\ir ../migrations/20261014100000_compras_recibidas.sql
SELECT CASE WHEN tipo_iva = 0.21 AND tipo_irpf = 0.15 AND liquido = 212
            THEN 'BIEN  7b. al volver a aplicarla, la gestoría toma 21 % y 15 %: líquido 212'
            ELSE 'MAL   7b. ' || tipo_iva || ' / ' || tipo_irpf || ' / ' || liquido END
FROM public.textil_compras WHERE numero = 'C2-7';
