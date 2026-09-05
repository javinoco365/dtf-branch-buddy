-- ============================================================================
-- El libro de caja
-- ============================================================================
-- Lo que se comprueba aquí es que las reglas viven en la base y no en la
-- pantalla: la categoria la manda el concepto, los nombres se congelan, y un
-- ingreso no puede llevar socio ni un gasto cliente.

DO $$
DECLARE v_empresa UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;
  PERFORM set_config('prueba.caja_empresa', v_empresa::TEXT, false);

  INSERT INTO public.tiendas (id, nombre, slug)
    VALUES ('88888888-8888-4888-8888-888888888888', 'Tienda caja', 'tienda-caja');
  INSERT INTO public.clientes (id, tienda_id, nombre, email)
    VALUES ('99999999-9999-4999-8999-999999999999',
            '88888888-8888-4888-8888-888888888888', 'Talleres Perez', 'tp@example.com');
END $$;

-- 1. Las semillas estan puestas.
SELECT CASE WHEN count(*) FILTER (WHERE categoria = 'ingreso') = 2
             AND count(*) FILTER (WHERE categoria = 'gasto') = 3
            THEN 'BIEN  1. cinco conceptos sembrados, dos de ingreso y tres de gasto'
            ELSE 'MAL   1. hay ' || count(*) || ' conceptos' END
FROM public.caja_conceptos;

SELECT CASE WHEN count(*) = 3
            THEN 'BIEN  2. los tres socios sembrados'
            ELSE 'MAL   2. hay ' || count(*) || ' socios' END
FROM public.caja_socios;

-- 3. Un ingreso: la categoria y los nombres los pone la base.
--    Se manda 'gasto' a proposito para comprobar que lo ignora.
INSERT INTO public.caja_movimientos
  (empresa_id, fecha, categoria, concepto_id, concepto_nombre, cliente_id, importe, observaciones)
SELECT current_setting('prueba.caja_empresa')::UUID, '2026-09-01', 'gasto',
       c.id, 'MENTIRA', '99999999-9999-4999-8999-999999999999', 120.50, '   '
  FROM public.caja_conceptos c WHERE c.nombre = 'Camisetas';

SELECT CASE WHEN categoria = 'ingreso' AND concepto_nombre = 'Camisetas'
             AND cliente_nombre = 'Talleres Perez' AND observaciones IS NULL
            THEN 'BIEN  3. la base impone categoria y congela los nombres'
            ELSE 'MAL   3. categoria=' || categoria || ' concepto=' || concepto_nombre
                 || ' cliente=' || COALESCE(cliente_nombre, 'NULL') END
FROM public.caja_movimientos WHERE importe = 120.50;

-- 4. Un gasto con socio.
INSERT INTO public.caja_movimientos
  (empresa_id, categoria, concepto_id, concepto_nombre, socio_id, importe)
SELECT current_setting('prueba.caja_empresa')::UUID, 'ingreso',
       c.id, 'x', s.id, 80
  FROM public.caja_conceptos c, public.caja_socios s
 WHERE c.nombre = 'Materiales' AND s.nombre = 'Javi C';

SELECT CASE WHEN categoria = 'gasto' AND socio_nombre = 'Javi C'
            THEN 'BIEN  4. el gasto queda con su socio y su categoria'
            ELSE 'MAL   4. categoria=' || categoria
                 || ' socio=' || COALESCE(socio_nombre, 'NULL') END
FROM public.caja_movimientos WHERE importe = 80;

-- 5. Un ingreso con socio: lo que Javier pidio que fuera imposible.
DO $$ BEGIN
  INSERT INTO public.caja_movimientos
    (empresa_id, categoria, concepto_id, concepto_nombre, socio_id, importe)
  SELECT current_setting('prueba.caja_empresa')::UUID, 'ingreso',
         c.id, 'x', s.id, 10
    FROM public.caja_conceptos c, public.caja_socios s
   WHERE c.nombre = 'Metros' AND s.nombre = 'Javi N';
  RAISE WARNING 'MAL   5. un ingreso ha admitido socio';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. ingreso con socio: rechazado';
END $$;

-- 6. Y un gasto con cliente.
DO $$ BEGIN
  INSERT INTO public.caja_movimientos
    (empresa_id, categoria, concepto_id, concepto_nombre, cliente_id, importe)
  SELECT current_setting('prueba.caja_empresa')::UUID, 'gasto',
         c.id, 'x', '99999999-9999-4999-8999-999999999999', 10
    FROM public.caja_conceptos c WHERE c.nombre = 'Nómina';
  RAISE WARNING 'MAL   6. un gasto ha admitido cliente';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  6. gasto con cliente: rechazado';
END $$;

-- 7. El importe no puede ser negativo: el signo lo da la categoria.
DO $$ BEGIN
  INSERT INTO public.caja_movimientos
    (empresa_id, categoria, concepto_id, concepto_nombre, importe)
  SELECT current_setting('prueba.caja_empresa')::UUID, 'gasto', c.id, 'x', -50
    FROM public.caja_conceptos c WHERE c.nombre = 'Materiales';
  RAISE WARNING 'MAL   7. se ha aceptado un importe negativo';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  7. importe negativo: rechazado';
END $$;

-- 8. Ni cero.
DO $$ BEGIN
  INSERT INTO public.caja_movimientos
    (empresa_id, categoria, concepto_id, concepto_nombre, importe)
  SELECT current_setting('prueba.caja_empresa')::UUID, 'gasto', c.id, 'x', 0
    FROM public.caja_conceptos c WHERE c.nombre = 'Materiales';
  RAISE WARNING 'MAL   8. se ha aceptado un importe de cero';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  8. importe cero: rechazado';
END $$;

-- 9. Renombrar el concepto no reescribe los apuntes ya hechos.
UPDATE public.caja_conceptos SET nombre = 'Consumibles' WHERE nombre = 'Materiales';
SELECT CASE WHEN concepto_nombre = 'Materiales'
            THEN 'BIEN  9. renombrar el concepto no toca los apuntes viejos'
            ELSE 'MAL   9. el apunte ahora dice ' || concepto_nombre END
FROM public.caja_movimientos WHERE importe = 80;

-- 10. Un concepto desactivado no admite apuntes nuevos.
UPDATE public.caja_conceptos SET activo = false WHERE nombre = 'Consumibles';
DO $$ BEGIN
  INSERT INTO public.caja_movimientos
    (empresa_id, categoria, concepto_id, concepto_nombre, importe)
  SELECT current_setting('prueba.caja_empresa')::UUID, 'gasto', c.id, 'x', 5
    FROM public.caja_conceptos c WHERE c.nombre = 'Consumibles';
  RAISE WARNING 'MAL  10. un concepto desactivado ha admitido un apunte';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 10. concepto desactivado: no admite apuntes nuevos';
END $$;

-- 11. Pero el apunte que ya lo usaba se sigue pudiendo corregir.
DO $$ BEGIN
  UPDATE public.caja_movimientos SET importe = 85 WHERE importe = 80;
  RAISE NOTICE 'BIEN 11. un apunte con concepto desactivado se sigue corrigiendo';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  11. no se ha podido corregir: %', SQLERRM;
END $$;

-- 12. Un concepto en uso no se borra: se desactiva.
DO $$ BEGIN
  DELETE FROM public.caja_conceptos WHERE nombre = 'Consumibles';
  RAISE WARNING 'MAL  12. se ha borrado un concepto en uso';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 12. borrar un concepto en uso: rechazado';
END $$;

-- 13. Dos conceptos con el mismo nombre, aunque cambie la caja de las letras.
DO $$ BEGIN
  INSERT INTO public.caja_conceptos (empresa_id, nombre, categoria)
  VALUES (current_setting('prueba.caja_empresa')::UUID, '  camisetas ', 'ingreso');
  RAISE WARNING 'MAL  13. se ha duplicado un concepto';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 13. concepto duplicado: rechazado';
END $$;

-- 14. Un apunte se puede borrar: no es un documento fiscal.
DO $$ BEGIN
  DELETE FROM public.caja_movimientos WHERE importe = 120.50;
  RAISE NOTICE 'BIEN 14. un apunte de caja se puede borrar';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL  14. no se ha podido borrar: %', SQLERRM;
END $$;

-- 15. Y todo lo anterior quedo registrado en la auditoria.
SELECT CASE WHEN count(*) >= 4
            THEN 'BIEN 15. la auditoria registro los movimientos de caja'
            ELSE 'MAL  15. solo ' || count(*) || ' filas de auditoria' END
FROM public.auditoria WHERE tabla = 'caja_movimientos';

-- 16. Sin politica FOR ALL en ninguna de las tres tablas.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 16. ninguna politica FOR ALL en las tablas de caja'
            ELSE 'MAL  16. ' || count(*) || ' politica(s) FOR ALL' END
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('caja_movimientos', 'caja_conceptos', 'caja_socios')
  AND cmd = 'ALL';
