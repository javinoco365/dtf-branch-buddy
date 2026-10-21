-- ============================================================================
-- SEGURIDAD (SEG-03, parte de lectura): las cuatro políticas de SELECT que
-- quedaban abiertas a cualquier sesión pasan a leer solo la propia empresa
-- ============================================================================
--
-- POR QUÉ
--   La auditoría de seguridad de octubre (SEG-03) encontró políticas
--   USING (true) en tablas con empresa_id: cualquier usuario con sesión, de
--   cualquier empresa y sin ninguna tienda, leía todos los movimientos de
--   banco, los contadores de numeración y el libro y las reservas de stock.
--   La rama de seguridad lo dejó como PENDIENTE porque la función de alcance,
--   mis_empresas(), la creaba la de rendimiento (20261031100100). Ya existe.
--
-- QUÉ HACE
--   Recrea, con el mismo nombre, estas cuatro políticas de lectura:
--     banco_movimientos          "banco lectura"
--     contadores                 "contadores lectura"
--     textil_stock_movimientos   "movimientos lectura autenticados"
--     textil_stock_reservas      "reservas lectura"
--   con USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])),
--   el mismo patrón que 20261031100100 usa en las demás tablas por empresa:
--   el admin ve todas las empresas; el resto, las de sus tiendas.
--   empresa_id es NOT NULL en las cuatro, así que ninguna fila queda huérfana.
--
--   Si la tabla tiene otra política de lectura con un nombre distinto, se para
--   antes de cambiar nada: quedaría abierta por esa otra (las políticas
--   permisivas se suman).
--
-- QUÉ NO TOCA
--   Ni datos, ni las políticas de alta, edición y baja (llevan ya la condición
--   de nivel de 20261031200200), ni ningún FOR ALL (no hay ninguno).
--
-- EFECTO EN LA APLICACIÓN
--   Hoy hay una sola empresa: los admin y los usuarios con alguna tienda ven
--   lo mismo que antes. Un usuario sin ninguna tienda asignada deja de ver
--   banco y stock (igual que ya no veía pedidos ni facturas).
--
-- REVERSIBLE: sí, con
--   supabase/reversiones/20261031300100_seguridad_lectura_por_empresa.sql,
--   que repone USING (true).
--
-- PRUEBA: supabase/pruebas/C22_seguridad.sql (casos 37 a 40).
-- ============================================================================

DO $$
DECLARE
  v_otra TEXT;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_otra
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd IN ('SELECT', 'ALL')
     AND (tablename, policyname) NOT IN (
       ('banco_movimientos', 'banco lectura'),
       ('contadores', 'contadores lectura'),
       ('textil_stock_movimientos', 'movimientos lectura autenticados'),
       ('textil_stock_reservas', 'reservas lectura'))
     AND tablename IN ('banco_movimientos', 'contadores',
                       'textil_stock_movimientos', 'textil_stock_reservas');
  IF v_otra IS NOT NULL THEN
    RAISE EXCEPTION 'seguridad_lectura_por_empresa: hay políticas de lectura con un nombre que no se esperaba (%). Revísalas antes de aplicar.', v_otra;
  END IF;
END $$;

DROP POLICY IF EXISTS "banco lectura" ON public.banco_movimientos;
CREATE POLICY "banco lectura" ON public.banco_movimientos FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "contadores lectura" ON public.contadores;
CREATE POLICY "contadores lectura" ON public.contadores FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "movimientos lectura autenticados" ON public.textil_stock_movimientos;
CREATE POLICY "movimientos lectura autenticados" ON public.textil_stock_movimientos
  FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "reservas lectura" ON public.textil_stock_reservas;
CREATE POLICY "reservas lectura" ON public.textil_stock_reservas FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));
