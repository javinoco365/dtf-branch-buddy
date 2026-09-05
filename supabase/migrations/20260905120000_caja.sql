-- ============================================================================
-- CAJA · El libro de efectivo y de lo que ponen los socios
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hoy no hay dónde apuntar lo que entra y sale en efectivo: la venta de
--   mostrador, el material que se paga en el momento, la nómina, o el dinero
--   que pone uno de los tres socios de su bolsillo. Eso vive hoy en una libreta
--   o en una hoja de cálculo, y el saldo se calcula sumando a mano.
--
-- QUÉ NO ES
--   No es la conciliación bancaria. banco_movimientos es el extracto del banco;
--   esto es el efectivo y las aportaciones de los socios. Son dos libros
--   distintos y mezclarlos es el error clásico: el mismo dinero aparecería dos
--   veces. Si algún día hay que cuadrarlos, se hace con un apunte de traspaso,
--   no fundiendo las tablas.
--
--   Tampoco es un libro fiscal. Un apunte de caja se puede corregir y borrar,
--   al revés que una factura emitida. Lo que impide que eso sea un agujero es
--   la auditoría: cada alta, cambio y baja queda registrada con su autor.
--
-- LAS TRES DECISIONES QUE MARCAN EL DISEÑO
--
--   1. EL IMPORTE ES SIEMPRE POSITIVO. El signo lo da la categoría. Guardar
--      -50 Y ADEMÁS categoria='gasto' son dos fuentes de verdad que se pueden
--      contradecir: el día que entre un -50 marcado como ingreso, el saldo
--      miente y nadie se entera. Con una sola fuente eso no puede pasar.
--
--   2. LOS NOMBRES SE CONGELAN. Renombrar el concepto «Materiales» no puede
--      reescribir los apuntes del año pasado, que decían «Materiales» porque
--      eso es lo que se apuntó. Mismo criterio que las líneas de pedido y el
--      receptor de la factura.
--
--   3. CLIENTE PARA EL INGRESO, SOCIO PARA EL GASTO. Es una restricción de la
--      base, no una validación de pantalla: un ingreso no lleva socio y un
--      gasto no lleva cliente, se escriba desde donde se escriba.
--
-- POR QUÉ UN TRIGGER Y NO CONFIAR EN LA PANTALLA
--   La categoría del apunte y los nombres congelados los pone la base leyendo
--   el concepto, el socio y el cliente. Si los mandara el navegador, bastaría
--   una llamada a mano para meter «Nómina» como ingreso, o un nombre congelado
--   que nunca existió. Aquí no hay forma.
--
-- POR QUÉ LOS SOCIOS SON UNA TABLA Y NO LOS USUARIOS
--   Un socio es un hecho del negocio —quién puso el dinero—, no una cuenta de
--   acceso. Si Álvaro no entra nunca al CRM, o alguien se da de baja como
--   usuario, el libro tiene que seguir diciendo Álvaro.
--
-- REVERSIBLE
--   Sí. Tres tablas nuevas, un tipo y un trigger. No toca nada existente.
--   Las semillas son los conceptos y socios que indicó Javier.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.caja_categoria AS ENUM ('ingreso', 'gasto');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.caja_categoria ya existe, se omite';
END $$;

-- ---------------------------------------------------------------------------
-- 1. Los conceptos del desplegable
-- ---------------------------------------------------------------------------
-- Cada concepto lleva su categoría: «Nómina» es siempre gasto y «Camisetas»
-- siempre ingreso. Si concepto y categoría fueran independientes acabaría
-- habiendo un «Camisetas / gasto» y un saldo que no cuadra.
CREATE TABLE IF NOT EXISTS public.caja_conceptos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL,
  categoria public.caja_categoria NOT NULL,
  -- No se borra un concepto en uso: se desactiva. Desaparece del desplegable y
  -- los apuntes viejos lo siguen leyendo.
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT caja_concepto_con_nombre CHECK (length(TRIM(nombre)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS caja_conceptos_nombre_unico
  ON public.caja_conceptos (empresa_id, lower(TRIM(nombre)));

COMMENT ON TABLE public.caja_conceptos IS
  'Opciones del desplegable Concepto. Se editan desde Ajustes. Un concepto en '
  'uso no se borra: se desactiva.';
COMMENT ON COLUMN public.caja_conceptos.categoria IS
  'Si el concepto es de ingreso o de gasto. El apunte hereda esta categoría.';

-- ---------------------------------------------------------------------------
-- 2. Los socios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.caja_socios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT caja_socio_con_nombre CHECK (length(TRIM(nombre)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS caja_socios_nombre_unico
  ON public.caja_socios (empresa_id, lower(TRIM(nombre)));

COMMENT ON TABLE public.caja_socios IS
  'Quién pone o saca el dinero. No son los usuarios de la aplicación: un socio '
  'sigue existiendo en el libro aunque no tenga acceso al CRM.';

-- ---------------------------------------------------------------------------
-- 3. El libro
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.caja_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,

  -- La pone el trigger leyendo el concepto. No se manda desde fuera.
  categoria public.caja_categoria NOT NULL,

  -- RESTRICT: un concepto usado no se borra. Para quitarlo del desplegable
  -- está `activo`.
  concepto_id UUID NOT NULL REFERENCES public.caja_conceptos(id) ON DELETE RESTRICT,
  concepto_nombre TEXT NOT NULL,

  -- Solo en ingresos. SET NULL porque el cliente se puede borrar y el apunte
  -- tiene que sobrevivir: para eso está el nombre congelado.
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT,

  -- Solo en gastos.
  socio_id UUID REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  socio_nombre TEXT,

  -- Siempre positivo: el signo lo da la categoría.
  importe NUMERIC(12,2) NOT NULL,
  observaciones TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT caja_importe_positivo CHECK (importe > 0),
  -- Lo que pidió Javier, en la base y no en la pantalla: cliente para el
  -- ingreso, socio para el gasto. Un ingreso puede no tener cliente (venta de
  -- mostrador anónima) y un gasto puede no tener socio (lo paga la empresa);
  -- lo único que se prohíbe es cruzarlos.
  CONSTRAINT caja_quien_segun_categoria CHECK (
    (categoria = 'ingreso' AND socio_id IS NULL)
    OR
    (categoria = 'gasto' AND cliente_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS caja_movimientos_por_fecha
  ON public.caja_movimientos (empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS caja_movimientos_por_socio
  ON public.caja_movimientos (socio_id) WHERE socio_id IS NOT NULL;

COMMENT ON TABLE public.caja_movimientos IS
  'Libro de caja: efectivo y aportaciones de socios. No es el extracto del '
  'banco (banco_movimientos) ni un libro fiscal.';
COMMENT ON COLUMN public.caja_movimientos.importe IS
  'Siempre positivo. El signo lo da la categoría: guardar el signo dos veces '
  'permitiría que se contradijeran.';
COMMENT ON COLUMN public.caja_movimientos.concepto_nombre IS
  'El nombre del concepto el día del apunte. Renombrarlo después no reescribe '
  'lo que ya se apuntó.';

-- ---------------------------------------------------------------------------
-- 4. El trigger que congela y hace cumplir la categoría
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caja_movimiento_congelar()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_concepto RECORD;
  v_socio RECORD;
  v_cliente_nombre TEXT;
BEGIN
  SELECT c.nombre, c.categoria, c.activo, c.empresa_id
    INTO v_concepto
    FROM public.caja_conceptos c WHERE c.id = NEW.concepto_id;

  IF v_concepto IS NULL THEN
    RAISE EXCEPTION 'El concepto % no existe', NEW.concepto_id;
  END IF;

  IF NEW.empresa_id IS DISTINCT FROM v_concepto.empresa_id THEN
    RAISE EXCEPTION 'El concepto no es de esta empresa';
  END IF;

  -- Un concepto desactivado no admite apuntes NUEVOS, pero los que ya existen
  -- se pueden seguir corrigiendo: si no, desactivar un concepto congelaría
  -- para siempre los apuntes que lo usan.
  IF TG_OP = 'INSERT' AND NOT v_concepto.activo THEN
    RAISE EXCEPTION 'El concepto «%» está desactivado y no admite apuntes nuevos',
      v_concepto.nombre;
  END IF;

  -- La categoría la manda el concepto, venga lo que venga de fuera.
  NEW.categoria := v_concepto.categoria;
  NEW.concepto_nombre := v_concepto.nombre;

  -- El CHECK de la tabla comprueba la coherencia, pero da un mensaje de
  -- restricción. Estos dicen qué ha pasado en cristiano.
  IF NEW.categoria = 'ingreso' AND NEW.socio_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un ingreso no lleva socio: «%» es un concepto de ingreso',
      v_concepto.nombre;
  END IF;
  IF NEW.categoria = 'gasto' AND NEW.cliente_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un gasto no lleva cliente: «%» es un concepto de gasto',
      v_concepto.nombre;
  END IF;

  IF NEW.socio_id IS NOT NULL THEN
    SELECT s.nombre, s.activo, s.empresa_id INTO v_socio
      FROM public.caja_socios s WHERE s.id = NEW.socio_id;
    IF v_socio IS NULL THEN
      RAISE EXCEPTION 'El socio % no existe', NEW.socio_id;
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM v_socio.empresa_id THEN
      RAISE EXCEPTION 'El socio no es de esta empresa';
    END IF;
    IF TG_OP = 'INSERT' AND NOT v_socio.activo THEN
      RAISE EXCEPTION 'El socio «%» está desactivado', v_socio.nombre;
    END IF;
    NEW.socio_nombre := v_socio.nombre;
  ELSE
    NEW.socio_nombre := NULL;
  END IF;

  IF NEW.cliente_id IS NOT NULL THEN
    SELECT cl.nombre INTO v_cliente_nombre
      FROM public.clientes cl WHERE cl.id = NEW.cliente_id;
    IF v_cliente_nombre IS NULL THEN
      RAISE EXCEPTION 'El cliente % no existe', NEW.cliente_id;
    END IF;
    NEW.cliente_nombre := v_cliente_nombre;
  ELSIF NEW.cliente_nombre IS NOT NULL THEN
    -- Una venta de mostrador a alguien que no está en la ficha de clientes:
    -- se admite el nombre suelto, pero limpio.
    NEW.cliente_nombre := NULLIF(TRIM(NEW.cliente_nombre), '');
  END IF;

  NEW.observaciones := NULLIF(TRIM(COALESCE(NEW.observaciones, '')), '');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS caja_movimientos_congelar ON public.caja_movimientos;
CREATE TRIGGER caja_movimientos_congelar
  BEFORE INSERT OR UPDATE ON public.caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.caja_movimiento_congelar();

DROP TRIGGER IF EXISTS caja_conceptos_touch ON public.caja_conceptos;
CREATE TRIGGER caja_conceptos_touch BEFORE UPDATE ON public.caja_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS caja_socios_touch ON public.caja_socios;
CREATE TRIGGER caja_socios_touch BEFORE UPDATE ON public.caja_socios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Permisos y RLS
-- ---------------------------------------------------------------------------
-- Políticas por operación y por empresa. Nada de FOR ALL.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caja_movimientos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.caja_conceptos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.caja_socios TO authenticated;
GRANT ALL ON public.caja_movimientos TO service_role;
GRANT ALL ON public.caja_conceptos TO service_role;
GRANT ALL ON public.caja_socios TO service_role;

-- Sin DELETE para conceptos ni socios: se desactivan. Borrar uno en uso
-- rompería los apuntes que lo referencian, y borrar uno sin usar tampoco hace
-- falta si desaparece del desplegable.
REVOKE DELETE ON public.caja_conceptos FROM authenticated, anon;
REVOKE DELETE ON public.caja_socios FROM authenticated, anon;

ALTER TABLE public.caja_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_conceptos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_socios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caja lectura" ON public.caja_movimientos;
CREATE POLICY "caja lectura" ON public.caja_movimientos
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja alta" ON public.caja_movimientos;
CREATE POLICY "caja alta" ON public.caja_movimientos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Un apunte de caja se corrige: no es un documento fiscal y teclear mal un
-- importe es normal. Quién lo cambió y qué decía antes queda en auditoria.
DROP POLICY IF EXISTS "caja edicion" ON public.caja_movimientos;
CREATE POLICY "caja edicion" ON public.caja_movimientos
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja baja" ON public.caja_movimientos;
CREATE POLICY "caja baja" ON public.caja_movimientos
  FOR DELETE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja conceptos lectura" ON public.caja_conceptos;
CREATE POLICY "caja conceptos lectura" ON public.caja_conceptos
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja conceptos alta" ON public.caja_conceptos;
CREATE POLICY "caja conceptos alta" ON public.caja_conceptos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja conceptos edicion" ON public.caja_conceptos;
CREATE POLICY "caja conceptos edicion" ON public.caja_conceptos
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja socios lectura" ON public.caja_socios;
CREATE POLICY "caja socios lectura" ON public.caja_socios
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja socios alta" ON public.caja_socios;
CREATE POLICY "caja socios alta" ON public.caja_socios
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "caja socios edicion" ON public.caja_socios;
CREATE POLICY "caja socios edicion" ON public.caja_socios
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

-- ---------------------------------------------------------------------------
-- 6. Auditoría
-- ---------------------------------------------------------------------------
-- Es el único control que hay: los tres usuarios son administradores con los
-- mismos permisos, y un apunte de caja se puede editar y borrar.
DROP TRIGGER IF EXISTS caja_movimientos_auditoria ON public.caja_movimientos;
CREATE TRIGGER caja_movimientos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS caja_conceptos_auditoria ON public.caja_conceptos;
CREATE TRIGGER caja_conceptos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.caja_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS caja_socios_auditoria ON public.caja_socios;
CREATE TRIGGER caja_socios_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.caja_socios
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- 7. Semillas
-- ---------------------------------------------------------------------------
-- Los conceptos y los socios que indicó Javier. No hay nada inventado: si
-- faltan, se añaden desde Ajustes.
INSERT INTO public.caja_conceptos (empresa_id, nombre, categoria, orden)
SELECT public.empresa_por_defecto(), v.nombre, v.categoria::public.caja_categoria, v.orden
  FROM (VALUES
    ('Camisetas',  'ingreso', 10),
    ('Metros',     'ingreso', 20),
    ('Materiales', 'gasto',   30),
    ('Arreglos',   'gasto',   40),
    ('Nómina',     'gasto',   50)
  ) AS v(nombre, categoria, orden)
 WHERE public.empresa_por_defecto() IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.caja_socios (empresa_id, nombre, orden)
SELECT public.empresa_por_defecto(), v.nombre, v.orden
  FROM (VALUES ('Javi C', 10), ('Javi N', 20), ('Álvaro', 30)) AS v(nombre, orden)
 WHERE public.empresa_por_defecto() IS NOT NULL
ON CONFLICT DO NOTHING;
