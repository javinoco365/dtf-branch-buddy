-- ============================================================================
-- INVERSIÓN · Lo que pone cada socio y lo que recupera
-- ============================================================================
--
-- QUÉ RESUELVE
--   Saber, en una línea por socio, cuánto lleva puesto cada uno y cuánto ha
--   recuperado. Es la cuenta que los tres se hacen de cabeza y que nadie tiene
--   escrita en el mismo sitio.
--
-- QUÉ NO ES
--   No es la caja. En `caja_movimientos` un gasto con socio es dinero que ese
--   socio pagó por algo concreto —material, un arreglo—. Aquí se anota capital:
--   dinero que se mete en la empresa y dinero que se saca.
--
--   ATENCIÓN, PORQUE ES FÁCIL CONTAR DOS VECES: si Javi C paga 80 € de material
--   de su bolsillo y eso se apunta en caja como gasto con socio, ese dinero YA
--   está registrado como puesto por él. Anotarlo además como aportación aquí lo
--   contaría dos veces. Las dos pantallas no se cruzan solas a propósito: cuál
--   de las dos cuenta cada cosa lo decidís vosotros, y lo importante es ser
--   coherentes.
--
-- POR QUÉ REUTILIZA caja_socios
--   Son los mismos tres. Una segunda lista de socios se desincroniza el primer
--   día que se añada a alguien en un sitio y no en el otro.
--
-- LAS DECISIONES, LAS MISMAS QUE EN CAJA
--   Importe siempre positivo, con el signo dado por el tipo. Nombre del socio
--   congelado en el apunte. Todo auditado, porque se puede editar y borrar.
--
-- REVERSIBLE
--   Sí. Un tipo y una tabla nuevos. No toca nada existente.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.inversion_tipo AS ENUM ('aportacion', 'retirada');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.inversion_tipo ya existe, se omite';
END $$;

COMMENT ON TYPE public.inversion_tipo IS
  'aportacion: dinero que el socio mete. retirada: lo que recupera, sea '
  'devolución de lo puesto o reparto de beneficios.';

CREATE TABLE IF NOT EXISTS public.inversion_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Aquí el socio SÍ es obligatorio, al revés que en caja: una inversión sin
  -- socio no es de nadie y no cuadra con nada.
  socio_id UUID NOT NULL REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  socio_nombre TEXT NOT NULL,

  tipo public.inversion_tipo NOT NULL,
  importe NUMERIC(12,2) NOT NULL,
  observaciones TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT inversion_importe_positivo CHECK (importe > 0)
);

CREATE INDEX IF NOT EXISTS inversion_por_fecha
  ON public.inversion_movimientos (empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS inversion_por_socio
  ON public.inversion_movimientos (socio_id);

COMMENT ON TABLE public.inversion_movimientos IS
  'Capital: lo que cada socio pone y lo que recupera. No es la caja: un gasto '
  'pagado por un socio se anota en caja_movimientos, no aquí.';
COMMENT ON COLUMN public.inversion_movimientos.importe IS
  'Siempre positivo. El signo lo da el tipo.';

-- ---------------------------------------------------------------------------
-- El nombre del socio lo congela la base
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inversion_congelar()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_socio RECORD;
BEGIN
  SELECT s.nombre, s.activo, s.empresa_id INTO v_socio
    FROM public.caja_socios s WHERE s.id = NEW.socio_id;

  IF v_socio IS NULL THEN
    RAISE EXCEPTION 'El socio % no existe', NEW.socio_id;
  END IF;
  IF NEW.empresa_id IS DISTINCT FROM v_socio.empresa_id THEN
    RAISE EXCEPTION 'El socio no es de esta empresa';
  END IF;
  -- Igual que en caja: un socio desactivado no admite apuntes nuevos, pero los
  -- que ya tiene se pueden seguir corrigiendo.
  IF TG_OP = 'INSERT' AND NOT v_socio.activo THEN
    RAISE EXCEPTION 'El socio «%» está desactivado', v_socio.nombre;
  END IF;

  NEW.socio_nombre := v_socio.nombre;
  NEW.observaciones := NULLIF(TRIM(COALESCE(NEW.observaciones, '')), '');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inversion_movimientos_congelar ON public.inversion_movimientos;
CREATE TRIGGER inversion_movimientos_congelar
  BEFORE INSERT OR UPDATE ON public.inversion_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.inversion_congelar();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inversion_movimientos TO authenticated;
GRANT ALL ON public.inversion_movimientos TO service_role;

ALTER TABLE public.inversion_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inversion lectura" ON public.inversion_movimientos;
CREATE POLICY "inversion lectura" ON public.inversion_movimientos
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "inversion alta" ON public.inversion_movimientos;
CREATE POLICY "inversion alta" ON public.inversion_movimientos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "inversion edicion" ON public.inversion_movimientos;
CREATE POLICY "inversion edicion" ON public.inversion_movimientos
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "inversion baja" ON public.inversion_movimientos;
CREATE POLICY "inversion baja" ON public.inversion_movimientos
  FOR DELETE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Es dinero entre socios y los tres tienen los mismos permisos: el registro es
-- el único control que hay sobre quién tocó qué.
DROP TRIGGER IF EXISTS inversion_movimientos_auditoria ON public.inversion_movimientos;
CREATE TRIGGER inversion_movimientos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.inversion_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
