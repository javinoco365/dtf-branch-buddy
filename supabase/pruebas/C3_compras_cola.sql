-- ============================================================================
-- Facturas recibidas: cola de revisión y duplicados
-- ============================================================================
-- Prueba 20261015100000_compras_cola.sql y su reversión.

-- La prueba anterior (C2) aplica la reversión de 20261014 y la vuelve a
-- aplicar; esa reversión borra borrada_en y, con ella, los índices de esta.
-- Las reversiones van en orden inverso: primero esta, luego aquella. Aquí se
-- deja la base como queda al aplicar todas las migraciones.
\ir ../migrations/20261015100000_compras_cola.sql

CREATE OR REPLACE FUNCTION pg_temp.nueva(_numero TEXT, _nif TEXT, _huella TEXT,
                                         _proveedor TEXT DEFAULT 'Tintas C3')
RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO public.textil_compras
    (empresa_id, proveedor, nif_proveedor, numero, fecha, base, total, categoria,
     revision, fichero_huella)
  VALUES ((SELECT id FROM public.empresas WHERE activa LIMIT 1), _proveedor, _nif, _numero,
          '2026-11-03', 100, 121, 'consumibles', 'pendiente', _huella)
  RETURNING id;
$$;

-- 1. Las compras de antes quedan revisadas.
SELECT CASE WHEN bool_and(revision = 'revisada') OR count(*) = 0
            THEN 'BIEN  1. las compras de antes quedan revisadas'
            ELSE 'MAL   1. alguna compra de antes no quedó revisada' END
FROM public.textil_compras WHERE fichero_huella IS NULL;

-- 2. Claves normalizadas: «F-0123» y «f 0123» son la misma factura.
SELECT pg_temp.nueva('F-0123', 'b-12.345.678', 'h1');
SELECT CASE WHEN proveedor_clave = 'B12345678' AND numero_clave = 'F0123'
            THEN 'BIEN  2a. NIF y número sin espacios, guiones ni minúsculas'
            ELSE 'MAL   2a. ' || proveedor_clave || ' / ' || numero_clave END
FROM public.textil_compras WHERE fichero_huella = 'h1';
SELECT pg_temp.nueva('A 7', NULL, 'h0', 'Mensajería Rápida, S.L.');
SELECT CASE WHEN proveedor_clave = 'MENSAJERIARAPIDASL' OR proveedor_clave LIKE 'MENSAJER%'
            THEN 'BIEN  2b. sin NIF, la clave es el nombre'
            ELSE 'MAL   2b. ' || proveedor_clave END
FROM public.textil_compras WHERE fichero_huella = 'h0';

-- 3. El mismo fichero no entra dos veces.
DO $$ BEGIN
  PERFORM pg_temp.nueva('F-9999', 'B99', 'h1');
  RAISE WARNING 'MAL   3a. entró dos veces el mismo fichero';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'BIEN 3a. el mismo fichero no entra dos veces';
END $$;
-- Si el primero se borró, sí (la pantalla avisa).
UPDATE public.textil_compras SET borrada_en = now() WHERE fichero_huella = 'h1';
SELECT pg_temp.nueva('F-0123', 'B12345678', 'h1');
SELECT 'BIEN  3b. borrado el primero, el fichero se puede volver a subir';

-- 4. En la cola puede haber dos copias de la misma factura (para avisar);
--    registradas, no.
SELECT pg_temp.nueva('f 0123', 'B-12345678', 'h2');
SELECT 'BIEN  4a. dos copias de la misma factura caben en la cola';
UPDATE public.textil_compras SET revision = 'revisada'
 WHERE fichero_huella = 'h1' AND borrada_en IS NULL;
SELECT CASE WHEN public.textil_compra_registrar(
         (SELECT id FROM public.textil_compras WHERE fichero_huella = 'h1' AND borrada_en IS NULL)) = 0
            THEN 'BIEN  4b. la primera se registra' ELSE 'MAL   4b.' END;
DO $$ BEGIN
  UPDATE public.textil_compras SET revision = 'revisada' WHERE fichero_huella = 'h2';
  PERFORM public.textil_compra_registrar((SELECT id FROM public.textil_compras WHERE fichero_huella = 'h2'));
  RAISE WARNING 'MAL   4c. se registró dos veces la misma factura';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'BIEN 4c. la misma factura no se registra dos veces';
END $$;

-- 5. Sin revisar no se registra.
DO $$ BEGIN
  PERFORM public.textil_compra_registrar(pg_temp.nueva('Z-1', 'B55', 'h5'));
  RAISE WARNING 'MAL   5. se registró una factura sin revisar';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN  5. una factura sin revisar no se registra';
END $$;

-- 6. Estados y confianza válidos.
SELECT pg_temp.nueva('Z-6', 'B66', 'h5');
DO $$ BEGIN
  UPDATE public.textil_compras SET revision = 'quizas' WHERE fichero_huella = 'h5';
  RAISE WARNING 'MAL   6a. entró un estado de revisión inventado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'BIEN 6a. estado de revisión desconocido rechazado';
END $$;
DO $$ BEGIN
  UPDATE public.textil_compras SET confianza = 1.5 WHERE fichero_huella = 'h5';
  RAISE WARNING 'MAL   6b. entró una confianza de 1,5';
EXCEPTION WHEN check_violation OR numeric_value_out_of_range THEN
  RAISE NOTICE 'BIEN 6b. la confianza va de 0 a 1';
END $$;

-- 7. Aplicarla otra vez no cambia nada.
\ir ../migrations/20261015100000_compras_cola.sql
SELECT CASE WHEN (SELECT count(*) FROM public.textil_compras WHERE fichero_huella LIKE 'h%') = 5
            THEN 'BIEN  7. aplicarla dos veces no cambia los datos'
            ELSE 'MAL   7. tras reaplicar cambian los datos' END;

-- 8. La reversión falla entera si hay duplicados que compra_unica no admite
--    (aquí, la copia h2 y la registrada h1), sin tocar nada.
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.textil_compras ADD CONSTRAINT compra_unica_prueba
      UNIQUE (empresa_id, proveedor, numero);
    ALTER TABLE public.textil_compras DROP CONSTRAINT compra_unica_prueba;
    RAISE NOTICE 'BIEN  8. (sin duplicados que impidan la reversión)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'BIEN  8. con duplicados, la reversión no se aplicaría: hay que resolverlos antes';
  END;
END $$;
DELETE FROM public.textil_compras WHERE fichero_huella IN ('h0', 'h2', 'h5')
   OR (fichero_huella = 'h1' AND borrada_en IS NOT NULL);
\ir ../reversiones/20261015100000_compras_cola.sql
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name = 'textil_compras' AND column_name = 'revision')
             AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compra_unica')
            THEN 'BIEN  9. la reversión quita la cola y repone compra_unica'
            ELSE 'MAL   9. la reversión no dejó la tabla como estaba' END;
\ir ../migrations/20261015100000_compras_cola.sql
SELECT 'BIEN 10. y se puede volver a aplicar';
