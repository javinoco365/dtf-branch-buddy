-- ============================================================================
-- Bancos: cuentas y extractos
-- ============================================================================
-- Prueba 20261016100000_banco_cuentas_extractos.sql y su reversión.

-- 1. Una cuenta con su IBAN; un IBAN mal escrito no entra.
INSERT INTO public.banco_cuentas (empresa_id, banco, alias, iban)
VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'BBVA', 'Principal',
        'ES91' || '2100' || '0418' || '4502' || '0005' || '1332');
SELECT 'BIEN  1a. cuenta con IBAN';
DO $$ BEGIN
  INSERT INTO public.banco_cuentas (empresa_id, banco, alias, iban)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'X', 'Mala', 'es91 2100 0418');
  RAISE WARNING 'MAL   1b. entró un IBAN con espacios y minúsculas';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 1b. el IBAN va sin espacios y en mayúsculas';
END $$;
DO $$ BEGIN
  INSERT INTO public.banco_cuentas (empresa_id, banco, alias, iban)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), 'BBVA', 'Repetida',
          'ES91' || '2100' || '0418' || '4502' || '0005' || '1332');
  RAISE WARNING 'MAL   1c. la misma cuenta dos veces';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'BIEN 1c. la misma cuenta no se da de alta dos veces';
END $$;

-- 2. Un extracto cuadra si saldo inicial + movimientos = saldo final, al céntimo.
INSERT INTO public.banco_extractos
  (empresa_id, cuenta_id, fichero, saldo_inicial, saldo_final, suma_movimientos, movimientos)
SELECT empresa_id, id, 'octubre.csv', 1000.00, 1234.56, 234.56, 3
  FROM public.banco_cuentas WHERE alias = 'Principal';
INSERT INTO public.banco_extractos
  (empresa_id, cuenta_id, fichero, saldo_inicial, saldo_final, suma_movimientos, movimientos)
SELECT empresa_id, id, 'noviembre.csv', 1234.56, 1500.00, 265.43, 2
  FROM public.banco_cuentas WHERE alias = 'Principal';
INSERT INTO public.banco_extractos
  (empresa_id, cuenta_id, fichero, saldo_inicial, saldo_final, suma_movimientos, movimientos)
SELECT empresa_id, id, 'sin-saldos.xlsx', NULL, NULL, 50, 1
  FROM public.banco_cuentas WHERE alias = 'Principal';
SELECT CASE WHEN (SELECT cuadra FROM public.banco_extractos WHERE fichero = 'octubre.csv')
             AND NOT (SELECT cuadra FROM public.banco_extractos WHERE fichero = 'noviembre.csv')
             AND NOT (SELECT cuadra FROM public.banco_extractos WHERE fichero = 'sin-saldos.xlsx')
            THEN 'BIEN  2. cuadra: sí al céntimo; no si falta 1 céntimo o faltan los saldos'
            ELSE 'MAL   2. cuadra mal calculado' END;

DO $$ BEGIN
  UPDATE public.banco_extractos SET cuadra = true WHERE fichero = 'noviembre.csv';
  RAISE WARNING 'MAL   3. se pudo escribir «cuadra» a mano';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. «cuadra» lo calcula la base';
END $$;

-- 4. Movimientos con cuenta, extracto y saldo; la cuenta no se borra con ellos.
INSERT INTO public.banco_movimientos (empresa_id, fecha, concepto, importe, huella, cuenta_id, extracto_id, saldo)
SELECT c.empresa_id, '2026-10-05', 'Transferencia', 234.56, 'c4-1', c.id, e.id, 1234.56
  FROM public.banco_cuentas c JOIN public.banco_extractos e ON e.cuenta_id = c.id
 WHERE c.alias = 'Principal' AND e.fichero = 'octubre.csv';
DO $$ BEGIN
  DELETE FROM public.banco_cuentas WHERE alias = 'Principal';
  RAISE WARNING 'MAL   4. se borró una cuenta con movimientos';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'BIEN  4. una cuenta con movimientos no se borra';
END $$;

-- 5. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261016100000_banco_cuentas_extractos.sql
SELECT CASE WHEN (SELECT count(*) FROM public.banco_extractos) = 3
             AND (SELECT saldo FROM public.banco_movimientos WHERE huella = 'c4-1') = 1234.56
            THEN 'BIEN  5. aplicarla dos veces no cambia los datos'
            ELSE 'MAL   5. tras reaplicar cambian los datos' END;

-- 6. La reversión deja los movimientos sin cuenta, y se puede volver a aplicar.
\ir ../reversiones/20261016100000_banco_cuentas_extractos.sql
SELECT CASE WHEN to_regclass('public.banco_cuentas') IS NULL
             AND EXISTS (SELECT 1 FROM public.banco_movimientos WHERE huella = 'c4-1')
            THEN 'BIEN  6. la reversión quita cuentas y extractos y deja los movimientos'
            ELSE 'MAL   6. la reversión no dejó la base como estaba' END;
\ir ../migrations/20261016100000_banco_cuentas_extractos.sql
DELETE FROM public.banco_movimientos WHERE huella = 'c4-1';
SELECT 'BIEN  7. y se puede volver a aplicar';
