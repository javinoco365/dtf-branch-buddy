-- ============================================================================
-- REVERSIÓN de 20261031300400_seguridad_escritura_por_empresa.sql
-- ============================================================================
-- Repone las siete políticas como las dejó 20261031200200: sin alcance por
-- empresa en la escritura y la lectura de conciliaciones abierta. No toca
-- datos.
--
-- OJO: vuelve a abrir SEG-03 en escritura: un editor sin tiendas escribe en
-- banco y stock de cualquier empresa, y cualquier sesión lee todas las
-- conciliaciones.
--
-- Orden: antes que la reversión de 20261031200200 (que quita la condición de
-- nivel que estas definiciones llevan al final).
-- ============================================================================

ALTER POLICY "banco alta" ON public.banco_movimientos
  WITH CHECK ((true) AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "banco baja" ON public.banco_movimientos
  USING ((NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c
                       WHERE c.movimiento_id = banco_movimientos.id))
         AND (SELECT public.rol_puede_borrar(auth.uid())));

ALTER POLICY "movimientos alta autenticados" ON public.textil_stock_movimientos
  WITH CHECK ((true) AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "reservas alta" ON public.textil_stock_reservas
  WITH CHECK ((true) AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "reservas edicion" ON public.textil_stock_reservas
  USING ((true) AND (SELECT public.rol_puede_escribir(auth.uid())))
  WITH CHECK ((true) AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "reservas baja" ON public.textil_stock_reservas
  USING ((true) AND (SELECT public.rol_puede_escribir(auth.uid())));

ALTER POLICY "conciliaciones lectura" ON public.banco_conciliaciones
  USING (true);

NOTIFY pgrst, 'reload schema';
