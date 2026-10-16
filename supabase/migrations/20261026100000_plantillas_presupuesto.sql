-- ============================================================================
-- PDF de presupuestos: una plantilla por tienda y una para el textil
-- ============================================================================
--
-- EL PROBLEMA
--   El PDF de presupuestos sale siempre con el mismo diseño, escrito en el
--   código: la cabecera, el logo y el nombre de la tienda (o de la marca, en
--   el textil), los títulos, las condiciones y el pie con los datos fiscales.
--   Para cambiar una palabra, el nombre comercial o dónde va el logo hay que
--   tocar el programa. Y no hay forma de que cada tienda, y el textil
--   personalizado, saquen su propio presupuesto.
--
-- QUÉ HACE
--   Crea public.plantillas_presupuesto, la plantilla que se edita en Ajustes
--   generales → PDF de presupuestos:
--     ambito      'tienda' (una fila por tienda) o 'textil' (una por empresa).
--     tienda_id   la tienda, si el ámbito es 'tienda'; NULL en el textil.
--     config      la plantilla en JSON: posiciones en milímetros, textos,
--                 qué se enseña y en qué orden. La aplicación la lee siempre
--                 con normalizarPlantilla() (src/dominio/plantilla-presupuesto.ts):
--                 lo que falte o venga mal sale con lo de por defecto, así que
--                 un JSON viejo o a medias nunca impide sacar un presupuesto.
--     logo_url    el logo propio de la plantilla (bucket público 'logos'). Si
--                 no tiene, sale el de la tienda o el de la marca.
--   Sin fila, el PDF sale con la plantilla de por defecto: el diseño de
--   siempre.
--
--   Reglas que pone la base, no la pantalla:
--     - Una sola plantilla por tienda y una sola de textil por empresa
--       (índices únicos parciales). La aplicación busca la fila y la cambia o
--       la crea; si dos guardan a la vez, el segundo alta choca con el índice.
--     - 'tienda' lleva tienda_id y 'textil' no (CHECK).
--     - config es siempre un objeto JSON (CHECK), y logo_url, si lo hay, una
--       dirección http(s) sin espacios.
--     - La empresa de una plantilla de tienda es la de su tienda: un trigger
--       la copia de tiendas al dar de alta o cambiar de tienda, aunque llegue
--       otra. La de textil, la que se indique o empresa_por_defecto().
--
-- PERMISOS
--   RLS activada, una política por operación (ninguna FOR ALL):
--     - Leer: quien es de la tienda (is_tienda_member), o, en el textil, quien
--       es de la empresa (es_miembro_empresa). Los administradores, siempre.
--     - Dar de alta, cambiar y borrar: solo administradores (has_role 'admin'),
--       con la misma condición de pertenencia.
--   anon no tiene ningún permiso; authenticated, SELECT, INSERT, UPDATE y
--   DELETE (la RLS decide qué filas); service_role, todo.
--   Borrar la fila es «volver a la plantilla de por defecto»: no hay nada
--   fiscal colgando de ella. El presupuesto no guarda el PDF; se rehace con
--   la plantilla vigente cada vez.
--
-- AUDITORÍA
--   Trigger plantillas_presupuesto_auditoria (AFTER INSERT OR UPDATE OR
--   DELETE → auditoria_registrar()), como las demás tablas. Las escrituras van
--   con la sesión del usuario: el autor es auth.uid(). La plantilla no lleva
--   nada sensible que enmascarar.
--
-- SIN ESTA MIGRACIÓN
--   Los PDF de presupuestos salen igual que antes (la plantilla de por
--   defecto), y el editor avisa de que falta esta migración para guardar.
--
-- NO TOCA NINGUNA FILA EXISTENTE. Se puede aplicar dos veces.
--
-- REVERSIBLE
--   Sí (pídelo antes: son DROP y se pierden las plantillas guardadas):
--     DROP TABLE public.plantillas_presupuesto;
--     DROP FUNCTION public.plantillas_presupuesto_empresa_de_tienda();
--   Las filas de auditoría que se hayan escrito se quedan: la tabla es
--   append-only. Los PDF vuelven a salir con el diseño de por defecto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plantillas_presupuesto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  ambito TEXT NOT NULL,
  tienda_id UUID REFERENCES public.tiendas(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plantillas_presupuesto_ambito_valido
    CHECK (ambito IN ('tienda', 'textil')),
  CONSTRAINT plantillas_presupuesto_tienda_segun_ambito
    CHECK ((ambito = 'tienda') = (tienda_id IS NOT NULL)),
  CONSTRAINT plantillas_presupuesto_config_objeto
    CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT plantillas_presupuesto_logo_url_valido
    CHECK (logo_url IS NULL OR logo_url ~* '^https?://[^[:space:]]+$')
);

COMMENT ON TABLE public.plantillas_presupuesto IS
  'La plantilla del PDF de presupuestos: una por tienda y una de textil por empresa. '
  'Sin fila, el PDF sale con la de por defecto. Se edita en Ajustes generales.';
COMMENT ON COLUMN public.plantillas_presupuesto.ambito IS
  '''tienda'' (con tienda_id) o ''textil'' (sin tienda_id, una por empresa).';
COMMENT ON COLUMN public.plantillas_presupuesto.tienda_id IS
  'La tienda de la plantilla. NULL en la de textil.';
COMMENT ON COLUMN public.plantillas_presupuesto.config IS
  'La plantilla en JSON (PlantillaPresupuesto, src/dominio/plantilla-presupuesto.ts). '
  'Se lee siempre con normalizarPlantilla(): lo que falte o venga mal sale con lo de por defecto.';
COMMENT ON COLUMN public.plantillas_presupuesto.logo_url IS
  'El logo propio de la plantilla (bucket público logos). NULL: el de la tienda o el de la marca.';

-- ---------------------------------------------------------------------------
-- Una plantilla por tienda; una de textil por empresa
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS plantillas_presupuesto_una_por_tienda
  ON public.plantillas_presupuesto (tienda_id)
  WHERE ambito = 'tienda';

CREATE UNIQUE INDEX IF NOT EXISTS plantillas_presupuesto_una_textil_por_empresa
  ON public.plantillas_presupuesto (empresa_id)
  WHERE ambito = 'textil';

-- ---------------------------------------------------------------------------
-- La empresa de una plantilla de tienda es la de su tienda
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para leer tiendas.empresa_id aunque la RLS de tiendas no
-- se la enseñe a quien escribe: si no es de la tienda, la política de alta lo
-- rechaza igual. Solo lee una columna de la tienda de la fila nueva.
CREATE OR REPLACE FUNCTION public.plantillas_presupuesto_empresa_de_tienda()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
BEGIN
  IF NEW.tienda_id IS NOT NULL THEN
    SELECT t.empresa_id INTO v_empresa FROM public.tiendas t WHERE t.id = NEW.tienda_id;
    IF v_empresa IS NOT NULL THEN
      NEW.empresa_id := v_empresa;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.plantillas_presupuesto_empresa_de_tienda() IS
  'Trigger: la plantilla de una tienda lleva la empresa de la tienda, llegue la que llegue.';

REVOKE EXECUTE ON FUNCTION public.plantillas_presupuesto_empresa_de_tienda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS plantillas_presupuesto_empresa ON public.plantillas_presupuesto;
CREATE TRIGGER plantillas_presupuesto_empresa
  BEFORE INSERT OR UPDATE OF tienda_id, empresa_id ON public.plantillas_presupuesto
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_presupuesto_empresa_de_tienda();

DROP TRIGGER IF EXISTS plantillas_presupuesto_touch ON public.plantillas_presupuesto;
CREATE TRIGGER plantillas_presupuesto_touch
  BEFORE UPDATE ON public.plantillas_presupuesto
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.plantillas_presupuesto FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantillas_presupuesto TO authenticated;
GRANT ALL ON public.plantillas_presupuesto TO service_role;

ALTER TABLE public.plantillas_presupuesto ENABLE ROW LEVEL SECURITY;

-- Por operación y nunca FOR ALL (CLAUDE.md). La condición de pertenencia es
-- la misma en las cuatro: la tienda de la fila, o la empresa en el textil.
DROP POLICY IF EXISTS "plantillas presupuesto lectura" ON public.plantillas_presupuesto;
CREATE POLICY "plantillas presupuesto lectura" ON public.plantillas_presupuesto
  FOR SELECT TO authenticated
  USING (
    (ambito = 'tienda' AND public.is_tienda_member(auth.uid(), tienda_id))
    OR (ambito = 'textil' AND public.es_miembro_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "plantillas presupuesto alta admin" ON public.plantillas_presupuesto;
CREATE POLICY "plantillas presupuesto alta admin" ON public.plantillas_presupuesto
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND (
      (ambito = 'tienda' AND public.is_tienda_member(auth.uid(), tienda_id))
      OR (ambito = 'textil' AND public.es_miembro_empresa(auth.uid(), empresa_id))
    )
  );

DROP POLICY IF EXISTS "plantillas presupuesto edicion admin" ON public.plantillas_presupuesto;
CREATE POLICY "plantillas presupuesto edicion admin" ON public.plantillas_presupuesto
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND (
      (ambito = 'tienda' AND public.is_tienda_member(auth.uid(), tienda_id))
      OR (ambito = 'textil' AND public.es_miembro_empresa(auth.uid(), empresa_id))
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND (
      (ambito = 'tienda' AND public.is_tienda_member(auth.uid(), tienda_id))
      OR (ambito = 'textil' AND public.es_miembro_empresa(auth.uid(), empresa_id))
    )
  );

DROP POLICY IF EXISTS "plantillas presupuesto baja admin" ON public.plantillas_presupuesto;
CREATE POLICY "plantillas presupuesto baja admin" ON public.plantillas_presupuesto
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND (
      (ambito = 'tienda' AND public.is_tienda_member(auth.uid(), tienda_id))
      OR (ambito = 'textil' AND public.es_miembro_empresa(auth.uid(), empresa_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
-- Lo que sale a nombre de la empresa en un presupuesto (nombre comercial,
-- datos fiscales, condiciones) es de lo que interesa saber quién lo cambió.
DROP TRIGGER IF EXISTS plantillas_presupuesto_auditoria ON public.plantillas_presupuesto;
CREATE TRIGGER plantillas_presupuesto_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.plantillas_presupuesto
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- Que la API vea la tabla nueva sin esperar.
NOTIFY pgrst, 'reload schema';
