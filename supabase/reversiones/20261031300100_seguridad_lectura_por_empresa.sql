-- Reversión de 20261031300100_seguridad_lectura_por_empresa.sql
-- Repone las cuatro políticas de lectura como estaban: USING (true).
-- No toca datos.

DROP POLICY IF EXISTS "banco lectura" ON public.banco_movimientos;
CREATE POLICY "banco lectura" ON public.banco_movimientos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "contadores lectura" ON public.contadores;
CREATE POLICY "contadores lectura" ON public.contadores
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "movimientos lectura autenticados" ON public.textil_stock_movimientos;
CREATE POLICY "movimientos lectura autenticados" ON public.textil_stock_movimientos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "reservas lectura" ON public.textil_stock_reservas;
CREATE POLICY "reservas lectura" ON public.textil_stock_reservas
  FOR SELECT TO authenticated USING (true);
