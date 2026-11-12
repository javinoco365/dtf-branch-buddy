-- ============================================================================
-- Lectura de empresas: solo quien puede ver esa empresa
-- ============================================================================
-- «empresas lectura autenticados» (20260902120000) era USING (true): cualquier
-- cuenta con sesión, aunque no tuviera nivel o estuviera desactivada, leía la
-- sociedad entera, con sus costes internos por metro (consumibles, packaging,
-- electricidad, UV) y sus series. Era la única política de lectura de la base
-- que no pasaba por el nivel (auditoría de seguridad de noviembre de 2026).
--
-- Pasa a la regla de todas las demás tablas raíz: mis_empresas() (nivel
-- activo: todas; sin nivel: las de sus tiendas asignadas; desactivado:
-- ninguna). mis_empresas() es SECURITY DEFINER y lee empresas sin RLS, así que
-- no hay recursión. Para admin, editor y visor activos no cambia nada.
--
-- Reversión: supabase/reversiones/20261114100000_empresas_lectura_por_nivel.sql
-- ============================================================================

ALTER POLICY "empresas lectura autenticados" ON public.empresas
  USING (id = ANY ((SELECT public.mis_empresas())::uuid[]));

ALTER POLICY "empresas lectura autenticados" ON public.empresas
  RENAME TO "empresas lectura";
