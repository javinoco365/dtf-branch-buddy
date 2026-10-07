-- ============================================================================
-- GERENCIA · AJUSTES: gastos fijos, objetivos y qué cuenta como vendido
-- ============================================================================
--
-- QUÉ RESUELVE
--   Tres cosas que Gerencia necesita saber y que solo sabe la empresa:
--
--   1. GASTOS FIJOS (alquiler, sueldos, cuota de autónomos, gestoría…). Sin
--      ellos, Gerencia enseña el margen pero no el beneficio. Cada gasto lleva
--      su importe al mes y desde cuándo aplica; para dejar de pagarlo se le
--      pone fecha de fin. Así, subir el alquiler en marzo no cambia el
--      beneficio de enero: se cierra el gasto viejo y se abre uno nuevo.
--
--   2. OBJETIVOS al mes: metros y ventas. Un objetivo vale desde su mes hasta
--      que se ponga otro. Igual que los gastos: cambiarlo no reescribe el
--      pasado.
--
--   3. SI LOS PEDIDOS WEB SIN PAGAR CUENTAN COMO VENDIDOS. En WooCommerce, un
--      pedido «pendiente de pago» o «en espera» puede no pagarse nunca.
--
-- LAS DECISIONES
--   - Importes sin IVA: se restan del margen, que va sin IVA. Un sueldo no
--     lleva IVA; el del alquiler o la gestoría se recupera.
--   - empresa_id en las tres tablas, RLS con una política por operación y
--     auditoría con autor, como la caja.
--   - Se puede borrar un gasto o un objetivo (un error al teclear), y queda en
--     la auditoría. Para dejar de pagar un gasto se le pone fecha de fin, no se
--     borra: si se borrara, desaparecería de los meses que sí se pagó.
--
-- REVERSIBLE
--   Sí. Tres tablas nuevas; no toca nada que exista. Para deshacerla, borrar
--   las tres tablas. La aplicación funciona sin ellas: Gerencia no enseña
--   beneficio ni objetivos, y los pedidos web sin pagar cuentan como hasta hoy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ajustes generales: una fila por empresa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gerencia_ajustes (
  empresa_id UUID PRIMARY KEY REFERENCES public.empresas(id) ON DELETE RESTRICT,
  -- Como hasta hoy por defecto: el pedido web pendiente cuenta como vendido.
  web_sin_pagar_cuenta BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gerencia_ajustes IS
  'Ajustes de Gerencia, uno por empresa. Se editan en Gerencia › Ajustes.';
COMMENT ON COLUMN public.gerencia_ajustes.web_sin_pagar_cuenta IS
  'Si los pedidos de WooCommerce pendientes de pago cuentan como vendidos en Gerencia.';

-- ---------------------------------------------------------------------------
-- 2. Gastos fijos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gerencia_gastos_fijos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  concepto TEXT NOT NULL,
  importe_mensual NUMERIC(12,2) NOT NULL,
  -- Primer día en que se paga, y último (vacío: se sigue pagando).
  desde DATE NOT NULL,
  hasta DATE,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gerencia_gasto_con_concepto CHECK (length(TRIM(concepto)) > 0),
  CONSTRAINT gerencia_gasto_importe_positivo CHECK (importe_mensual > 0),
  CONSTRAINT gerencia_gasto_fechas CHECK (hasta IS NULL OR hasta >= desde)
);

CREATE INDEX IF NOT EXISTS gerencia_gastos_fijos_empresa_idx
  ON public.gerencia_gastos_fijos (empresa_id, desde);

COMMENT ON TABLE public.gerencia_gastos_fijos IS
  'Gastos fijos al mes, sin IVA, con su vigencia. Gerencia los prorratea por días '
  'para el periodo que se mire y los resta del margen.';

-- ---------------------------------------------------------------------------
-- 3. Objetivos al mes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gerencia_objetivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  -- El primer día del mes desde el que vale. Hasta el siguiente objetivo.
  desde DATE NOT NULL,
  metros NUMERIC(12,2),
  -- Vendido al mes, con IVA: se compara con «Vendido».
  vendido NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gerencia_objetivo_primer_dia CHECK (desde = date_trunc('month', desde)::DATE),
  CONSTRAINT gerencia_objetivo_algo CHECK (metros IS NOT NULL OR vendido IS NOT NULL),
  CONSTRAINT gerencia_objetivo_positivo CHECK (
    (metros IS NULL OR metros > 0) AND (vendido IS NULL OR vendido > 0)
  ),
  CONSTRAINT gerencia_objetivo_uno_por_mes UNIQUE (empresa_id, desde)
);

COMMENT ON TABLE public.gerencia_objetivos IS
  'Objetivos al mes de metros y de vendido (con IVA). Cada uno vale desde su mes '
  'hasta el siguiente objetivo.';

-- ---------------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS gerencia_ajustes_touch ON public.gerencia_ajustes;
CREATE TRIGGER gerencia_ajustes_touch BEFORE UPDATE ON public.gerencia_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS gerencia_gastos_fijos_touch ON public.gerencia_gastos_fijos;
CREATE TRIGGER gerencia_gastos_fijos_touch BEFORE UPDATE ON public.gerencia_gastos_fijos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS gerencia_objetivos_touch ON public.gerencia_objetivos;
CREATE TRIGGER gerencia_objetivos_touch BEFORE UPDATE ON public.gerencia_objetivos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Permisos: una política por operación, nunca FOR ALL
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.gerencia_ajustes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gerencia_gastos_fijos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gerencia_objetivos TO authenticated;
GRANT ALL ON public.gerencia_ajustes TO service_role;
GRANT ALL ON public.gerencia_gastos_fijos TO service_role;
GRANT ALL ON public.gerencia_objetivos TO service_role;

ALTER TABLE public.gerencia_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerencia_gastos_fijos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gerencia_objetivos ENABLE ROW LEVEL SECURITY;

-- Ajustes: se leen, se crean y se cambian. No se borran: sin fila, valen los
-- valores por defecto.
DROP POLICY IF EXISTS "gerencia ajustes lectura" ON public.gerencia_ajustes;
CREATE POLICY "gerencia ajustes lectura" ON public.gerencia_ajustes
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia ajustes alta" ON public.gerencia_ajustes;
CREATE POLICY "gerencia ajustes alta" ON public.gerencia_ajustes
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia ajustes edicion" ON public.gerencia_ajustes;
CREATE POLICY "gerencia ajustes edicion" ON public.gerencia_ajustes
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Gastos fijos
DROP POLICY IF EXISTS "gerencia gastos lectura" ON public.gerencia_gastos_fijos;
CREATE POLICY "gerencia gastos lectura" ON public.gerencia_gastos_fijos
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia gastos alta" ON public.gerencia_gastos_fijos;
CREATE POLICY "gerencia gastos alta" ON public.gerencia_gastos_fijos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia gastos edicion" ON public.gerencia_gastos_fijos;
CREATE POLICY "gerencia gastos edicion" ON public.gerencia_gastos_fijos
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia gastos baja" ON public.gerencia_gastos_fijos;
CREATE POLICY "gerencia gastos baja" ON public.gerencia_gastos_fijos
  FOR DELETE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Objetivos
DROP POLICY IF EXISTS "gerencia objetivos lectura" ON public.gerencia_objetivos;
CREATE POLICY "gerencia objetivos lectura" ON public.gerencia_objetivos
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia objetivos alta" ON public.gerencia_objetivos;
CREATE POLICY "gerencia objetivos alta" ON public.gerencia_objetivos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia objetivos edicion" ON public.gerencia_objetivos;
CREATE POLICY "gerencia objetivos edicion" ON public.gerencia_objetivos
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "gerencia objetivos baja" ON public.gerencia_objetivos;
CREATE POLICY "gerencia objetivos baja" ON public.gerencia_objetivos
  FOR DELETE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- ---------------------------------------------------------------------------
-- 6. Auditoría: quién cambió cada ajuste, y qué decía antes
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS gerencia_ajustes_auditoria ON public.gerencia_ajustes;
CREATE TRIGGER gerencia_ajustes_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.gerencia_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS gerencia_gastos_fijos_auditoria ON public.gerencia_gastos_fijos;
CREATE TRIGGER gerencia_gastos_fijos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.gerencia_gastos_fijos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS gerencia_objetivos_auditoria ON public.gerencia_objetivos;
CREATE TRIGGER gerencia_objetivos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.gerencia_objetivos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
