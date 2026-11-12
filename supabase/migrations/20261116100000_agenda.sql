-- ============================================================================
-- Agenda: categorías, tareas y su historial
-- ============================================================================
--
-- QUÉ HACE
--   1. public.agenda_categorias: los tipos de tarea que se eligen al crearla.
--      Pedido y Cliente piden enlazar un pedido o un cliente; las demás, nada.
--      Se añaden, renombran, ordenan y desactivan en Ajustes. No se borran.
--      Semilla (decidida por Javier): Pedido, Cliente, Gestión, Trabajo,
--      Revisión y Otro.
--   2. public.agenda_tareas: la tarea. Quién la hace y quién la manda son
--      SOCIOS (caja_socios), no cuentas: la cuenta de gerencia la usan varios
--      (socio_cuentas, 20261115100000). Tres estados: pendiente, hecha,
--      cancelada. No se borran: se cancelan.
--   3. public.agenda_tarea_historial: quién hizo qué con cada tarea (creada,
--      editada, pasada a otra persona, hecha, reabierta, cancelada), con la
--      PERSONA (cambio_socio_id), que la auditoría no conoce: la auditoría
--      guarda la cuenta. Lo escribe un trigger; nadie más.
--
-- REGLAS QUE PONE LA BASE (trigger agenda_tarea_preparar)
--   - La empresa de la tarea es la de su categoría; los socios y el pedido o
--     cliente enlazado tienen que ser de esa empresa.
--   - Categoría con enlace 'pedido' lleva pedido_id (y no cliente_id); con
--     'cliente', cliente_id (y no pedido_id); sin enlace, ninguno. enlace_texto
--     congela cómo se llamaba lo enlazado («Pedido 1042 · Taller Ruiz»), para
--     que la tarea se siga leyendo si el pedido o el cliente desaparecen
--     (ON DELETE SET NULL).
--   - Todo el día: sin fin. Con hora: fin posterior al inicio (CHECK).
--   - hecha_en se pone al pasar a hecha y se quita al reabrir.
--   - Al cambiar de destinatario, vista_en vuelve a NULL: le sale como nueva.
--     Una tarea que alguien se manda a sí mismo nace vista.
--
-- PERMISOS
--   RLS por operación, nunca FOR ALL. Leer: quien ve la empresa
--   (es_miembro_empresa). Dar de alta y cambiar: además, nivel de escritura
--   (rol_puede_escribir, al final, como toda política de escritura). Sin
--   DELETE para authenticated en ninguna de las tres: categorías se
--   desactivan, tareas se cancelan, el historial no se toca.
--   Guardia rol_guardia('escribir') en las tres, para los caminos sin RLS.
--
-- AUDITORÍA
--   auditoria_registrar() en categorías y tareas. El historial no lleva: es
--   él mismo un registro derivado de las tareas, que ya se auditan.
--
-- NO TOCA NINGUNA FILA EXISTENTE (solo da de alta las seis categorías).
-- Se puede aplicar dos veces.
--
-- REVERSIBLE: sí, con supabase/reversiones/20261116100000_agenda.sql (son
-- DROP: se pierden las tareas y categorías que se hayan creado).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Categorías
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agenda_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL,
  enlace TEXT,
  icono TEXT,
  activa BOOLEAN NOT NULL DEFAULT true,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agenda_categoria_con_nombre
    CHECK (length(TRIM(nombre)) BETWEEN 1 AND 40),
  CONSTRAINT agenda_categoria_enlace_valido
    CHECK (enlace IS NULL OR enlace IN ('pedido', 'cliente')),
  CONSTRAINT agenda_categoria_icono_valido
    CHECK (icono IS NULL OR icono ~ '^[a-z-]{1,20}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_categorias_nombre_unico
  ON public.agenda_categorias (empresa_id, lower(TRIM(nombre)));

COMMENT ON TABLE public.agenda_categorias IS
  'Tipos de tarea de la Agenda. Se desactivan, no se borran. Se gestionan en Ajustes.';
COMMENT ON COLUMN public.agenda_categorias.enlace IS
  '''pedido'' o ''cliente'': la tarea de esta categoría enlaza uno. NULL: sin enlace.';
COMMENT ON COLUMN public.agenda_categorias.icono IS
  'Nombre del icono en la interfaz (package, user, briefcase, wrench, eye, tag...). NULL: el de por defecto.';

DROP TRIGGER IF EXISTS agenda_categorias_touch ON public.agenda_categorias;
CREATE TRIGGER agenda_categorias_touch BEFORE UPDATE ON public.agenda_categorias
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Tareas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agenda_tareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- La pone el trigger con la de la categoría.
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL,
  notas TEXT,
  categoria_id UUID NOT NULL REFERENCES public.agenda_categorias(id) ON DELETE RESTRICT,
  prioridad TEXT NOT NULL DEFAULT 'normal',
  todo_el_dia BOOLEAN NOT NULL DEFAULT true,
  -- Todo el día: las 00:00 de ese día en Madrid. Con hora: el instante.
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ,
  de_socio_id UUID NOT NULL REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  para_socio_id UUID NOT NULL REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  pedido_id UUID REFERENCES public.pedidos(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  enlace_texto TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  hecha_en TIMESTAMPTZ,
  -- Cuándo la abrió su destinatario. NULL: le sale como nueva.
  vista_en TIMESTAMPTZ,
  -- La persona que hace el cambio (no la cuenta): la manda la aplicación en
  -- cada escritura y el historial la apunta.
  cambio_socio_id UUID REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agenda_tarea_con_titulo
    CHECK (length(TRIM(titulo)) BETWEEN 1 AND 200),
  CONSTRAINT agenda_tarea_notas_largo
    CHECK (notas IS NULL OR length(notas) <= 4000),
  CONSTRAINT agenda_tarea_prioridad_valida
    CHECK (prioridad IN ('urgente', 'alta', 'normal', 'baja')),
  CONSTRAINT agenda_tarea_estado_valido
    CHECK (estado IN ('pendiente', 'hecha', 'cancelada')),
  CONSTRAINT agenda_tarea_horas
    CHECK ((todo_el_dia AND fin IS NULL) OR (NOT todo_el_dia AND fin IS NOT NULL AND fin > inicio)),
  CONSTRAINT agenda_tarea_un_enlace
    CHECK (pedido_id IS NULL OR cliente_id IS NULL)
);

CREATE INDEX IF NOT EXISTS agenda_tareas_empresa_inicio ON public.agenda_tareas (empresa_id, inicio);
CREATE INDEX IF NOT EXISTS agenda_tareas_para ON public.agenda_tareas (para_socio_id, estado);
CREATE INDEX IF NOT EXISTS agenda_tareas_de ON public.agenda_tareas (de_socio_id);
CREATE INDEX IF NOT EXISTS agenda_tareas_pedido ON public.agenda_tareas (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_tareas_cliente ON public.agenda_tareas (cliente_id) WHERE cliente_id IS NOT NULL;

COMMENT ON TABLE public.agenda_tareas IS
  'Tareas de la Agenda. De un socio para otro (o para sí mismo). No se borran: se cancelan.';
COMMENT ON COLUMN public.agenda_tareas.enlace_texto IS
  'Cómo se llamaba el pedido o el cliente enlazado al enlazarlo: se lee aunque desaparezca.';

DROP TRIGGER IF EXISTS agenda_tareas_touch ON public.agenda_tareas;
CREATE TRIGGER agenda_tareas_touch BEFORE UPDATE ON public.agenda_tareas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Historial
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agenda_tarea_historial (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  tarea_id UUID NOT NULL REFERENCES public.agenda_tareas(id) ON DELETE CASCADE,
  socio_id UUID REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  accion TEXT NOT NULL,
  para_antes UUID REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  para_despues UUID REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agenda_historial_accion_valida
    CHECK (accion IN ('creada', 'editada', 'pasada', 'hecha', 'reabierta', 'cancelada'))
);

CREATE INDEX IF NOT EXISTS agenda_tarea_historial_tarea
  ON public.agenda_tarea_historial (tarea_id, created_at);

COMMENT ON TABLE public.agenda_tarea_historial IS
  'Qué persona hizo qué con cada tarea. Lo escribe el trigger agenda_tarea_historial_registrar; nadie más.';

-- ---------------------------------------------------------------------------
-- 4. Reglas de la tarea
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para leer la categoría, los socios, el pedido y el cliente
-- aunque la RLS de quien escribe no los enseñe: si no es de la empresa, la
-- política de alta lo rechaza igual.
CREATE OR REPLACE FUNCTION public.agenda_tarea_preparar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_enlace TEXT;
  v_texto TEXT;
  v_socio UUID;
  v_empresa_enlace UUID;
  v_cambia_enlace BOOLEAN;
BEGIN
  SELECT c.empresa_id, c.enlace INTO v_empresa, v_enlace
    FROM public.agenda_categorias c WHERE c.id = NEW.categoria_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'La categoría de la tarea no existe' USING ERRCODE = '23503';
  END IF;
  NEW.empresa_id := v_empresa;

  FOREACH v_socio IN ARRAY ARRAY[NEW.de_socio_id, NEW.para_socio_id, NEW.cambio_socio_id] LOOP
    IF v_socio IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.caja_socios s WHERE s.id = v_socio AND s.empresa_id = v_empresa
    ) THEN
      RAISE EXCEPTION 'Esa persona no es de esta empresa' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- Un ON DELETE SET NULL del pedido o del cliente llega aquí anidado
  -- (pg_trigger_depth() > 1): la tarea se queda con su enlace_texto y no se
  -- le exige el enlace que acaba de perder.
  v_cambia_enlace := TG_OP = 'INSERT'
    OR NEW.categoria_id IS DISTINCT FROM OLD.categoria_id
    OR NEW.pedido_id IS DISTINCT FROM OLD.pedido_id
    OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id;

  IF v_cambia_enlace AND pg_trigger_depth() = 1 THEN
    IF v_enlace = 'pedido' THEN
      IF NEW.pedido_id IS NULL THEN
        RAISE EXCEPTION 'Una tarea de esta categoría tiene que llevar un pedido' USING ERRCODE = '23514';
      END IF;
      NEW.cliente_id := NULL;
      SELECT 'Pedido ' || p.numero || COALESCE(' · ' || NULLIF(TRIM(c.nombre), ''), ''), p.empresa_id
        INTO v_texto, v_empresa_enlace
        FROM public.pedidos p LEFT JOIN public.clientes c ON c.id = p.cliente_id
       WHERE p.id = NEW.pedido_id;
      IF v_texto IS NULL OR v_empresa_enlace IS DISTINCT FROM v_empresa THEN
        RAISE EXCEPTION 'Ese pedido no existe o no es de esta empresa' USING ERRCODE = '23503';
      END IF;
      NEW.enlace_texto := v_texto;
    ELSIF v_enlace = 'cliente' THEN
      IF NEW.cliente_id IS NULL THEN
        RAISE EXCEPTION 'Una tarea de esta categoría tiene que llevar un cliente' USING ERRCODE = '23514';
      END IF;
      NEW.pedido_id := NULL;
      SELECT TRIM(c.nombre), c.empresa_id INTO v_texto, v_empresa_enlace
        FROM public.clientes c WHERE c.id = NEW.cliente_id;
      IF v_texto IS NULL OR v_empresa_enlace IS DISTINCT FROM v_empresa THEN
        RAISE EXCEPTION 'Ese cliente no existe o no es de esta empresa' USING ERRCODE = '23503';
      END IF;
      NEW.enlace_texto := v_texto;
    ELSE
      NEW.pedido_id := NULL;
      NEW.cliente_id := NULL;
      NEW.enlace_texto := NULL;
    END IF;
  END IF;

  IF NEW.estado = 'hecha' AND (TG_OP = 'INSERT' OR OLD.estado <> 'hecha') THEN
    NEW.hecha_en := now();
  ELSIF NEW.estado <> 'hecha' THEN
    NEW.hecha_en := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.vista_en := CASE WHEN NEW.para_socio_id = NEW.de_socio_id THEN now() END;
    NEW.cambio_socio_id := COALESCE(NEW.cambio_socio_id, NEW.de_socio_id);
  ELSIF NEW.para_socio_id IS DISTINCT FROM OLD.para_socio_id THEN
    NEW.vista_en := CASE WHEN NEW.para_socio_id = NEW.cambio_socio_id THEN now() END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agenda_tarea_preparar() IS
  'Trigger: empresa de la categoría, socios y enlace de esa empresa, enlace según la categoría, hecha_en y vista_en.';
REVOKE EXECUTE ON FUNCTION public.agenda_tarea_preparar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agenda_tarea_preparar ON public.agenda_tareas;
CREATE TRIGGER agenda_tarea_preparar
  BEFORE INSERT OR UPDATE ON public.agenda_tareas
  FOR EACH ROW EXECUTE FUNCTION public.agenda_tarea_preparar();

-- Escribe el historial. Un mismo UPDATE puede dejar varias líneas (por ejemplo,
-- pasarla y editarla a la vez). Marcar como vista no deja ninguna.
CREATE OR REPLACE FUNCTION public.agenda_tarea_historial_registrar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.agenda_tarea_historial (empresa_id, tarea_id, socio_id, accion, para_despues)
    VALUES (NEW.empresa_id, NEW.id, NEW.cambio_socio_id, 'creada', NEW.para_socio_id);
    RETURN NULL;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.agenda_tarea_historial (empresa_id, tarea_id, socio_id, accion)
    VALUES (NEW.empresa_id, NEW.id, NEW.cambio_socio_id,
            CASE NEW.estado WHEN 'hecha' THEN 'hecha'
                            WHEN 'cancelada' THEN 'cancelada'
                            ELSE 'reabierta' END);
  END IF;

  IF NEW.para_socio_id IS DISTINCT FROM OLD.para_socio_id THEN
    INSERT INTO public.agenda_tarea_historial
      (empresa_id, tarea_id, socio_id, accion, para_antes, para_despues)
    VALUES (NEW.empresa_id, NEW.id, NEW.cambio_socio_id, 'pasada',
            OLD.para_socio_id, NEW.para_socio_id);
  END IF;

  IF (NEW.titulo, NEW.notas, NEW.categoria_id, NEW.prioridad, NEW.todo_el_dia,
      NEW.inicio, NEW.fin, NEW.pedido_id, NEW.cliente_id)
     IS DISTINCT FROM
     (OLD.titulo, OLD.notas, OLD.categoria_id, OLD.prioridad, OLD.todo_el_dia,
      OLD.inicio, OLD.fin, OLD.pedido_id, OLD.cliente_id)
     AND pg_trigger_depth() = 1 THEN
    INSERT INTO public.agenda_tarea_historial (empresa_id, tarea_id, socio_id, accion)
    VALUES (NEW.empresa_id, NEW.id, NEW.cambio_socio_id, 'editada');
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.agenda_tarea_historial_registrar() IS
  'Trigger: apunta en agenda_tarea_historial quién creó, editó, pasó, hizo, reabrió o canceló cada tarea.';
REVOKE EXECUTE ON FUNCTION public.agenda_tarea_historial_registrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agenda_tarea_historial ON public.agenda_tareas;
CREATE TRIGGER agenda_tarea_historial
  AFTER INSERT OR UPDATE ON public.agenda_tareas
  FOR EACH ROW EXECUTE FUNCTION public.agenda_tarea_historial_registrar();

-- ---------------------------------------------------------------------------
-- 5. Permisos y RLS
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.agenda_categorias FROM anon, authenticated;
REVOKE ALL ON public.agenda_tareas FROM anon, authenticated;
REVOKE ALL ON public.agenda_tarea_historial FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agenda_categorias TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agenda_tareas TO authenticated;
GRANT SELECT ON public.agenda_tarea_historial TO authenticated;
GRANT ALL ON public.agenda_categorias TO service_role;
GRANT ALL ON public.agenda_tareas TO service_role;
GRANT ALL ON public.agenda_tarea_historial TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agenda_tarea_historial_id_seq TO service_role;

ALTER TABLE public.agenda_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_tarea_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agenda categorias lectura" ON public.agenda_categorias;
CREATE POLICY "agenda categorias lectura" ON public.agenda_categorias
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "agenda categorias alta" ON public.agenda_categorias;
CREATE POLICY "agenda categorias alta" ON public.agenda_categorias
  FOR INSERT TO authenticated
  WITH CHECK (
    public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  );

DROP POLICY IF EXISTS "agenda categorias edicion" ON public.agenda_categorias;
CREATE POLICY "agenda categorias edicion" ON public.agenda_categorias
  FOR UPDATE TO authenticated
  USING (
    public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  )
  WITH CHECK (
    public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  );

DROP POLICY IF EXISTS "agenda tareas lectura" ON public.agenda_tareas;
CREATE POLICY "agenda tareas lectura" ON public.agenda_tareas
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "agenda tareas alta" ON public.agenda_tareas;
CREATE POLICY "agenda tareas alta" ON public.agenda_tareas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  );

DROP POLICY IF EXISTS "agenda tareas edicion" ON public.agenda_tareas;
CREATE POLICY "agenda tareas edicion" ON public.agenda_tareas
  FOR UPDATE TO authenticated
  USING (
    public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  )
  WITH CHECK (
    public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  );

DROP POLICY IF EXISTS "agenda historial lectura" ON public.agenda_tarea_historial;
CREATE POLICY "agenda historial lectura" ON public.agenda_tarea_historial
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP TRIGGER IF EXISTS rol_guardia ON public.agenda_categorias;
CREATE TRIGGER rol_guardia BEFORE INSERT OR UPDATE OR DELETE ON public.agenda_categorias
  FOR EACH STATEMENT EXECUTE FUNCTION public.rol_guardia('escribir');
DROP TRIGGER IF EXISTS rol_guardia ON public.agenda_tareas;
CREATE TRIGGER rol_guardia BEFORE INSERT OR UPDATE OR DELETE ON public.agenda_tareas
  FOR EACH STATEMENT EXECUTE FUNCTION public.rol_guardia('escribir');
DROP TRIGGER IF EXISTS rol_guardia ON public.agenda_tarea_historial;
CREATE TRIGGER rol_guardia BEFORE INSERT OR UPDATE OR DELETE ON public.agenda_tarea_historial
  FOR EACH STATEMENT EXECUTE FUNCTION public.rol_guardia('escribir');

-- ---------------------------------------------------------------------------
-- 6. Auditoría
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS agenda_categorias_auditoria ON public.agenda_categorias;
CREATE TRIGGER agenda_categorias_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.agenda_categorias
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS agenda_tareas_auditoria ON public.agenda_tareas;
CREATE TRIGGER agenda_tareas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.agenda_tareas
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- 7. Semilla: las seis categorías que decidió Javier
-- ---------------------------------------------------------------------------
INSERT INTO public.agenda_categorias (empresa_id, nombre, enlace, icono, orden)
SELECT public.empresa_por_defecto(), v.nombre, v.enlace, v.icono, v.orden
  FROM (VALUES
    ('Pedido',   'pedido',  'package',   10),
    ('Cliente',  'cliente', 'user',      20),
    ('Gestión',  NULL,      'briefcase', 30),
    ('Trabajo',  NULL,      'wrench',    40),
    ('Revisión', NULL,      'eye',       50),
    ('Otro',     NULL,      'tag',       60)
  ) AS v(nombre, enlace, icono, orden)
 WHERE public.empresa_por_defecto() IS NOT NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
