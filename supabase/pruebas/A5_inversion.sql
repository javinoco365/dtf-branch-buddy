-- ============================================================================
-- Inversión de los socios
-- ============================================================================
-- Reutiliza los socios de caja a proposito: dos listas de socios se
-- desincronizan el primer dia que se añada a alguien en un sitio y no en otro.

DO $$
DECLARE v_empresa UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;
  PERFORM set_config('prueba.inv_empresa', v_empresa::TEXT, false);
END $$;

-- 1. Una aportacion: el nombre del socio lo congela la base.
INSERT INTO public.inversion_movimientos
  (empresa_id, fecha, socio_id, socio_nombre, tipo, importe, observaciones)
SELECT current_setting('prueba.inv_empresa')::UUID, '2026-01-15',
       s.id, 'MENTIRA', 'aportacion', 5000, '   '
  FROM public.caja_socios s WHERE s.nombre = 'Javi C';

SELECT CASE WHEN socio_nombre = 'Javi C' AND observaciones IS NULL
            THEN 'BIEN  1. la base congela el nombre del socio'
            ELSE 'MAL   1. socio=' || socio_nombre END
FROM public.inversion_movimientos WHERE importe = 5000;

-- 2. Una retirada del mismo socio.
INSERT INTO public.inversion_movimientos (empresa_id, socio_id, socio_nombre, tipo, importe)
SELECT current_setting('prueba.inv_empresa')::UUID, s.id, 'x', 'retirada', 1200
  FROM public.caja_socios s WHERE s.nombre = 'Javi C';

SELECT CASE WHEN count(*) = 2
            THEN 'BIEN  2. aportacion y retirada conviven en el mismo socio'
            ELSE 'MAL   2. hay ' || count(*) || ' apuntes' END
FROM public.inversion_movimientos;

-- 3. Un importe negativo: el signo lo da el tipo, no el numero.
DO $$ BEGIN
  INSERT INTO public.inversion_movimientos (empresa_id, socio_id, socio_nombre, tipo, importe)
  SELECT current_setting('prueba.inv_empresa')::UUID, s.id, 'x', 'retirada', -100
    FROM public.caja_socios s WHERE s.nombre = 'Javi N';
  RAISE WARNING 'MAL   3. se ha aceptado un importe negativo';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  3. importe negativo: rechazado';
END $$;

-- 4. Y cero tampoco.
DO $$ BEGIN
  INSERT INTO public.inversion_movimientos (empresa_id, socio_id, socio_nombre, tipo, importe)
  SELECT current_setting('prueba.inv_empresa')::UUID, s.id, 'x', 'aportacion', 0
    FROM public.caja_socios s WHERE s.nombre = 'Javi N';
  RAISE WARNING 'MAL   4. se ha aceptado un importe de cero';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  4. importe cero: rechazado';
END $$;

-- 5. Sin socio no hay inversion: no es de nadie y no cuadra con nada.
DO $$ BEGIN
  INSERT INTO public.inversion_movimientos (empresa_id, socio_id, socio_nombre, tipo, importe)
  VALUES (current_setting('prueba.inv_empresa')::UUID, NULL, 'x', 'aportacion', 100);
  RAISE WARNING 'MAL   5. se ha aceptado una inversion sin socio';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. inversion sin socio: rechazada';
END $$;

-- 6. Renombrar el socio no reescribe los apuntes ya hechos.
UPDATE public.caja_socios SET nombre = 'Javier C.' WHERE nombre = 'Javi C';
SELECT CASE WHEN socio_nombre = 'Javi C'
            THEN 'BIEN  6. renombrar el socio no toca los apuntes viejos'
            ELSE 'MAL   6. el apunte ahora dice ' || socio_nombre END
FROM public.inversion_movimientos WHERE importe = 5000;

-- 7. Un socio con inversion no se borra.
DO $$ BEGIN
  DELETE FROM public.caja_socios WHERE nombre = 'Javier C.';
  RAISE WARNING 'MAL   7. se ha borrado un socio con inversion';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  7. borrar un socio con inversion: rechazado';
END $$;

-- 8. Un socio desactivado no admite apuntes nuevos.
UPDATE public.caja_socios SET activo = false WHERE nombre = 'Javier C.';
DO $$ BEGIN
  INSERT INTO public.inversion_movimientos (empresa_id, socio_id, socio_nombre, tipo, importe)
  SELECT current_setting('prueba.inv_empresa')::UUID, s.id, 'x', 'aportacion', 50
    FROM public.caja_socios s WHERE s.nombre = 'Javier C.';
  RAISE WARNING 'MAL   8. un socio desactivado ha admitido un apunte';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  8. socio desactivado: no admite apuntes nuevos';
END $$;

-- 9. Pero los que ya tenia se siguen corrigiendo.
DO $$ BEGIN
  UPDATE public.inversion_movimientos SET importe = 5500 WHERE importe = 5000;
  RAISE NOTICE 'BIEN  9. un apunte de un socio desactivado se sigue corrigiendo';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   9. no se ha podido corregir: %', SQLERRM;
END $$;

-- 10. Todo queda en la auditoria: es dinero entre socios.
SELECT CASE WHEN count(*) >= 3
            THEN 'BIEN 10. la auditoria registro los movimientos de inversion'
            ELSE 'MAL  10. solo ' || count(*) || ' filas' END
FROM public.auditoria WHERE tabla = 'inversion_movimientos';

-- 11. Sin politicas FOR ALL.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 11. ninguna politica FOR ALL en inversion_movimientos'
            ELSE 'MAL  11. ' || count(*) || ' politica(s) FOR ALL' END
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'inversion_movimientos' AND cmd = 'ALL';

-- Se deja el socio como estaba, que las pruebas siguientes comparten base.
UPDATE public.caja_socios SET nombre = 'Javi C', activo = true WHERE nombre = 'Javier C.';
