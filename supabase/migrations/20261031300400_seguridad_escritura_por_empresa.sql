-- ============================================================================
-- SEGURIDAD (SEG-03, parte de escritura): banco y stock solo en la propia
-- empresa, y las conciliaciones se leen por empresa (hallazgo SEG-REV-2)
-- ============================================================================
--
-- EL FALLO
--   20261031300100 cerró la LECTURA por empresa. La escritura de estas tablas
--   seguía con la condición que traía de antes, «true», a la que
--   20261031200200 solo añadió el nivel:
--
--     banco_movimientos          "banco alta"                     INSERT
--     banco_movimientos          "banco baja"                     DELETE (sin empresa)
--     textil_stock_movimientos   "movimientos alta autenticados"  INSERT
--     textil_stock_reservas      "reservas alta"                  INSERT
--     textil_stock_reservas      "reservas edicion"               UPDATE
--     textil_stock_reservas      "reservas baja"                  DELETE
--
--   Un editor sin ninguna tienda (mis_empresas() = {}) daba de alta
--   movimientos de banco en cualquier empresa y cambiaba o borraba reservas de
--   stock de cualquiera. Y banco_conciliaciones "conciliaciones lectura" seguía
--   con USING (true): cualquier sesión leía todas las conciliaciones (la tabla
--   no tiene empresa_id; la prueba C22 solo miraba las que lo tienen).
--
-- QUÉ HACE
--   1. A esas seis políticas les añade, delante de lo que ya tenían,
--        empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
--      el mismo alcance que su lectura. La condición de nivel se queda.
--   2. "conciliaciones lectura" pasa a leer solo las conciliaciones de un
--      movimiento de banco de las empresas de quien lee.
--
--   Si alguna de esas políticas no existe con ese nombre, se para sin cambiar
--   nada: quedaría una puerta abierta con otro nombre.
--
-- EFECTO EN LA APLICACIÓN
--   Hoy hay una sola empresa: los admin y quien tiene alguna tienda escriben y
--   leen lo mismo que antes. Un usuario sin ninguna tienda ya no escribe en
--   banco ni en stock. Las escrituras de las funciones SECURITY DEFINER
--   (conciliar, reservar al confirmar un pedido...) no pasan por la RLS y no
--   cambian.
--
-- DEPENDE DE 20261031100100 (mis_empresas) y 20261031200200 (el nivel).
--
-- REVERSIBLE: sí, con
--   supabase/reversiones/20261031300400_seguridad_escritura_por_empresa.sql
--   (repone las condiciones de antes). Va antes que la de 20261031200200.
--
-- PRUEBA: supabase/pruebas/C22_seguridad.sql (casos 36 y 41 a 43).
-- ============================================================================

DO $$
DECLARE
  v_faltan TEXT;
BEGIN
  SELECT string_agg(e.tabla || '.' || e.politica, ', ') INTO v_faltan
    FROM (VALUES
      ('banco_movimientos', 'banco alta'),
      ('banco_movimientos', 'banco baja'),
      ('textil_stock_movimientos', 'movimientos alta autenticados'),
      ('textil_stock_reservas', 'reservas alta'),
      ('textil_stock_reservas', 'reservas edicion'),
      ('textil_stock_reservas', 'reservas baja'),
      ('banco_conciliaciones', 'conciliaciones lectura')
    ) AS e(tabla, politica)
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = e.tabla
                        AND p.policyname = e.politica);
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'seguridad_escritura_por_empresa: no existen estas políticas (%). No se ha cambiado nada; revisar las de esas tablas antes de aplicar.', v_faltan;
  END IF;
END $$;

ALTER POLICY "banco alta" ON public.banco_movimientos
  WITH CHECK (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
              AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "banco baja" ON public.banco_movimientos
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
         AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c
                          WHERE c.movimiento_id = banco_movimientos.id)
         AND (SELECT public.rol_puede_borrar(auth.uid())));

ALTER POLICY "movimientos alta autenticados" ON public.textil_stock_movimientos
  WITH CHECK (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
              AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "reservas alta" ON public.textil_stock_reservas
  WITH CHECK (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
              AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "reservas edicion" ON public.textil_stock_reservas
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
         AND (SELECT public.rol_puede_escribir(auth.uid())))
  WITH CHECK (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
              AND (SELECT public.rol_puede_escribir(auth.uid())));

-- Las reservas son líneas que se reescriben al editar el pedido: el borrado
-- exige escribir, no borrar (como en 20261031200200).
ALTER POLICY "reservas baja" ON public.textil_stock_reservas
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])
         AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "conciliaciones lectura" ON public.banco_conciliaciones
  USING (EXISTS (SELECT 1 FROM public.banco_movimientos m
                  WHERE m.id = banco_conciliaciones.movimiento_id
                    AND m.empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])));

NOTIFY pgrst, 'reload schema';
