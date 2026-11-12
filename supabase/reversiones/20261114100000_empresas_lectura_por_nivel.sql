-- ============================================================================
-- REVERSIÓN de 20261114100000_empresas_lectura_por_nivel.sql
-- ============================================================================
-- Vuelve a dejar que cualquier usuario con sesión lea todas las empresas.
-- ============================================================================

ALTER POLICY "empresas lectura" ON public.empresas
  RENAME TO "empresas lectura autenticados";

ALTER POLICY "empresas lectura autenticados" ON public.empresas
  USING (true);
