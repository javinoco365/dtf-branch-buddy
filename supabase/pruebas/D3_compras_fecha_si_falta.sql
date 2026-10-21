-- ============================================================================
-- Una compra registrada sin fecha puede recibir su fecha (una sola vez)
-- ============================================================================
-- Prueba 20261031400200_compras_fecha_si_falta.sql. La migración se aplica
-- otra vez aquí, dos veces (tiene que poder repetirse), porque pruebas
-- anteriores reaplican 20261029100100 y dejan la función vieja.
--
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

\ir ../migrations/20261031400200_compras_fecha_si_falta.sql
\ir ../migrations/20261031400200_compras_fecha_si_falta.sql

CREATE FUNCTION pg_temp.intento(_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE || ' ' || SQLERRM;
END $$;

INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, iva, total, categoria, estado)
VALUES ((SELECT id FROM public.empresas ORDER BY created_at LIMIT 1),
        'Sin fecha D3', 'D3-1', NULL, 100, 21, 121, 'otros', 'registrada'),
       ((SELECT id FROM public.empresas ORDER BY created_at LIMIT 1),
        'Con fecha D3', 'D3-2', DATE '2026-09-15', 100, 21, 121, 'otros', 'registrada');

-- 1. Una registrada sin fecha recibe su fecha. (La comprobación va en otra
--    sentencia: la misma no vería el cambio de la función.)
SELECT CASE WHEN r = 'ok' THEN 'BIEN  1a. la compra registrada sin fecha acepta su fecha'
            ELSE 'MAL   1a. no se pudo completar la fecha: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = DATE ''2026-10-01'' WHERE numero = ''D3-1''') AS r) x;
SELECT CASE WHEN fecha = DATE '2026-10-01' THEN 'BIEN  1b. y la fecha queda guardada'
            ELSE 'MAL   1b. la fecha guardada es ' || COALESCE(fecha::TEXT, 'nula') END
  FROM public.textil_compras WHERE numero = 'D3-1';

-- 2. Una vez puesta, ya no se cambia.
SELECT CASE WHEN r LIKE 'error 23001 %«fecha» no se puede cambiar%'
            THEN 'BIEN  2. la fecha recién puesta ya no se cambia'
            ELSE 'MAL   2. se cambió una fecha ya puesta: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = DATE ''2026-10-02'' WHERE numero = ''D3-1''') AS r) x;

-- 3. Una registrada con fecha de origen tampoco la cambia.
SELECT CASE WHEN r LIKE 'error 23001 %«fecha» no se puede cambiar%'
            THEN 'BIEN  3. la fecha de una compra registrada con fecha no se cambia'
            ELSE 'MAL   3. se cambió la fecha de una compra registrada: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = DATE ''2026-09-16'' WHERE numero = ''D3-2''') AS r) x;

-- 4. Ni se vacía.
SELECT CASE WHEN r LIKE 'error 23001 %«fecha» no se puede cambiar%'
            THEN 'BIEN  4. la fecha de una compra registrada no se vacía'
            ELSE 'MAL   4. se vació la fecha de una compra registrada: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = NULL WHERE numero = ''D3-2''') AS r) x;

-- 5. Una fecha posterior a hoy no se acepta.
INSERT INTO public.textil_compras (empresa_id, proveedor, numero, fecha, base, iva, total, categoria, estado)
VALUES ((SELECT id FROM public.empresas ORDER BY created_at LIMIT 1),
        'Futura D3', 'D3-3', NULL, 10, 2.1, 12.1, 'otros', 'registrada');
SELECT CASE WHEN r LIKE 'error 22023 %posterior a hoy%'
            THEN 'BIEN  5. no se completa con una fecha posterior a hoy'
            ELSE 'MAL   5. aceptó una fecha futura: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = current_date + 5 WHERE numero = ''D3-3''') AS r) x;

-- 6. El resto de campos sigue igual de protegido.
SELECT CASE WHEN r LIKE 'error 23001 %«base» no se puede cambiar%'
            THEN 'BIEN  6. la base de una compra registrada sigue sin poder cambiarse'
            ELSE 'MAL   6. se cambió la base: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET base = 99 WHERE numero = ''D3-1''') AS r) x;

-- 7. Y sigue sin borrarse.
SELECT CASE WHEN r LIKE 'error 23001 %no se borra%'
            THEN 'BIEN  7. una compra registrada sigue sin borrarse'
            ELSE 'MAL   7. se borró una compra registrada: ' || r END
  FROM (SELECT pg_temp.intento(
          'DELETE FROM public.textil_compras WHERE numero = ''D3-1''') AS r) x;

-- 8. La reversión vuelve a cerrar la fecha (también de vacía a un valor), y
--    la migración se puede volver a aplicar.
\ir ../reversiones/20261031400200_compras_fecha_si_falta.sql
SELECT CASE WHEN r LIKE 'error 23001 %«fecha» no se puede cambiar%'
            THEN 'BIEN  8a. con la reversión, una compra sin fecha ya no la recibe'
            ELSE 'MAL   8a. la reversión no cierra la fecha: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = DATE ''2026-10-01'' WHERE numero = ''D3-3''') AS r) x;
\ir ../migrations/20261031400200_compras_fecha_si_falta.sql
SELECT CASE WHEN r = 'ok'
            THEN 'BIEN  8b. reaplicada, la compra sin fecha la recibe otra vez'
            ELSE 'MAL   8b. reaplicada no deja completar la fecha: ' || r END
  FROM (SELECT pg_temp.intento(
          'UPDATE public.textil_compras SET fecha = DATE ''2026-10-01'' WHERE numero = ''D3-3''') AS r) x;

ROLLBACK;
