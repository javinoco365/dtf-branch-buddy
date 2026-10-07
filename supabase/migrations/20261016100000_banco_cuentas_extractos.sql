-- ============================================================================
-- BANCOS: CUENTAS Y EXTRACTOS
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hasta ahora los movimientos del banco eran de «el banco», sin decir de
--   qué cuenta, y el extracto no se guardaba: no se podía saber si un
--   extracto cuadraba (saldo inicial + movimientos = saldo final) ni separar
--   dos cuentas (y hará falta para los traspasos entre cuentas propias).
--
-- QUÉ CAMBIA
--   banco_cuentas (nueva): banco, alias e IBAN (sin espacios, en mayúsculas).
--   banco_extractos (nueva): cada fichero importado, con la cuenta, el
--     formato que se detectó (tipo, codificación, separador, orden de la
--     fecha, decimal), el periodo, el saldo inicial y final, lo que suman sus
--     movimientos y `cuadra`, que calcula la base: saldo inicial + suma =
--     saldo final, al céntimo. Un extracto no se edita: es lo que dijo el
--     banco.
--   banco_movimientos: cuenta_id, extracto_id y saldo (el saldo tras el
--     movimiento, si el banco lo da). Los de antes quedan sin cuenta.
--
-- PERMISOS
--   Como el resto: RLS por operación y por empresa (es_miembro_empresa), sin
--   FOR ALL, y auditoría por trigger. Una cuenta con movimientos no se borra.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261016100000_banco_cuentas_extractos.sql.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cuentas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.banco_cuentas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  banco TEXT NOT NULL,
  alias TEXT NOT NULL,
  iban TEXT,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT banco_cuenta_textos CHECK (length(trim(banco)) > 0 AND length(trim(alias)) > 0),
  CONSTRAINT banco_cuenta_iban CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  CONSTRAINT banco_cuenta_unica UNIQUE (empresa_id, iban)
);

COMMENT ON TABLE public.banco_cuentas IS 'Cuentas bancarias de la empresa.';
COMMENT ON COLUMN public.banco_cuentas.iban IS 'IBAN sin espacios y en mayúsculas.';

-- ---------------------------------------------------------------------------
-- 2. Extractos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.banco_extractos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  cuenta_id UUID NOT NULL REFERENCES public.banco_cuentas(id) ON DELETE RESTRICT,
  fichero TEXT NOT NULL,
  formato JSONB NOT NULL DEFAULT '{}'::jsonb,
  desde DATE,
  hasta DATE,
  saldo_inicial NUMERIC(14,2),
  saldo_final NUMERIC(14,2),
  suma_movimientos NUMERIC(14,2) NOT NULL DEFAULT 0,
  movimientos INT NOT NULL DEFAULT 0,
  nuevos INT NOT NULL DEFAULT 0,
  cuadra BOOLEAN GENERATED ALWAYS AS (
    saldo_inicial IS NOT NULL AND saldo_final IS NOT NULL
    AND saldo_inicial + suma_movimientos = saldo_final
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT banco_extracto_periodo CHECK (desde IS NULL OR hasta IS NULL OR desde <= hasta),
  CONSTRAINT banco_extracto_cuentas CHECK (movimientos >= 0 AND nuevos >= 0 AND nuevos <= movimientos)
);

COMMENT ON TABLE public.banco_extractos IS
  'Cada extracto importado: formato detectado, periodo, saldos y si cuadra (lo calcula la base).';
COMMENT ON COLUMN public.banco_extractos.cuadra IS
  'saldo_inicial + suma_movimientos = saldo_final, al céntimo. Falso si falta algún saldo.';

CREATE INDEX IF NOT EXISTS banco_extractos_por_cuenta
  ON public.banco_extractos (cuenta_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Movimientos: de qué cuenta, de qué extracto, con qué saldo
-- ---------------------------------------------------------------------------
ALTER TABLE public.banco_movimientos
  ADD COLUMN IF NOT EXISTS cuenta_id UUID REFERENCES public.banco_cuentas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS extracto_id UUID REFERENCES public.banco_extractos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS saldo NUMERIC(14,2);

CREATE INDEX IF NOT EXISTS banco_movimientos_por_cuenta
  ON public.banco_movimientos (cuenta_id, fecha DESC);

COMMENT ON COLUMN public.banco_movimientos.saldo IS 'Saldo de la cuenta tras el movimiento, si el banco lo da.';

-- ---------------------------------------------------------------------------
-- 4. Permisos, RLS por operación y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banco_cuentas TO authenticated;
GRANT SELECT, INSERT ON public.banco_extractos TO authenticated;
GRANT ALL ON public.banco_cuentas TO service_role;
GRANT ALL ON public.banco_extractos TO service_role;

ALTER TABLE public.banco_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banco_extractos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cuentas lectura" ON public.banco_cuentas;
CREATE POLICY "cuentas lectura" ON public.banco_cuentas
  FOR SELECT TO authenticated USING (public.es_miembro_empresa(auth.uid(), empresa_id));
DROP POLICY IF EXISTS "cuentas alta" ON public.banco_cuentas;
CREATE POLICY "cuentas alta" ON public.banco_cuentas
  FOR INSERT TO authenticated WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));
DROP POLICY IF EXISTS "cuentas edicion" ON public.banco_cuentas;
CREATE POLICY "cuentas edicion" ON public.banco_cuentas
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));
-- Una cuenta con movimientos o extractos no se borra (las claves lo impiden).
DROP POLICY IF EXISTS "cuentas baja" ON public.banco_cuentas;
CREATE POLICY "cuentas baja" ON public.banco_cuentas
  FOR DELETE TO authenticated USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Un extracto es lo que dijo el banco: se lee y se crea, no se edita ni se borra.
DROP POLICY IF EXISTS "extractos lectura" ON public.banco_extractos;
CREATE POLICY "extractos lectura" ON public.banco_extractos
  FOR SELECT TO authenticated USING (public.es_miembro_empresa(auth.uid(), empresa_id));
DROP POLICY IF EXISTS "extractos alta" ON public.banco_extractos;
CREATE POLICY "extractos alta" ON public.banco_extractos
  FOR INSERT TO authenticated WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP TRIGGER IF EXISTS banco_cuentas_auditoria ON public.banco_cuentas;
CREATE TRIGGER banco_cuentas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.banco_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS banco_extractos_auditoria ON public.banco_extractos;
CREATE TRIGGER banco_extractos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.banco_extractos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
