-- ============================================================================
-- CIMIENTOS 3/6 · RLS por empresa y red de seguridad para tablas nuevas
-- ============================================================================
--
-- QUÉ HACE
--   1. Añade es_miembro_empresa(), el equivalente por empresa de la actual
--      is_tienda_member().
--   2. Sustituye las políticas USING (true) de las nueve tablas textil_*, que
--      hoy dejan que cualquier usuario autenticado lea y escriba todo.
--   3. Añade el event trigger rls_auto_enable(), para que ninguna tabla nueva
--      pueda nacer sin RLS por descuido.
--   4. Impide borrar físicamente una factura textil ya emitida.
--
-- POR QUÉ
--   Las nueve tablas del módulo textil tienen políticas
--   FOR ALL TO authenticated USING (true) WITH CHECK (true). Con tres
--   administradores da igual; el día que entre un cuarto usuario, lo ve y lo
--   escribe todo, incluidas las facturas.
--
-- ATENCIÓN, ESTO CAMBIA EL COMPORTAMIENTO DE LA APLICACIÓN
--   El punto 4 hace que falle el botón de la papelera de la pantalla de
--   facturas textil cuando la factura está emitida. Hoy ese botón ejecuta
--   deleteTextilFactura, que borra la fila y sus líneas en cascada sin mirar el
--   estado: destruye un documento fiscal desde la interfaz. Es una violación
--   directa de la regla de que una factura emitida no se borra nunca.
--   Retirar el botón y sustituirlo por «emitir rectificativa» es la tarea
--   siguiente; esta migración solo impide que se siga destruyendo mientras
--   tanto.
--
-- REVERSIBLE
--   Sí. Restaurar las políticas USING (true) y eliminar el event trigger, la
--   función y el trigger de borrado deshace todo. No se pierde ningún dato.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pertenencia a una empresa
-- ---------------------------------------------------------------------------
-- Un usuario pertenece a una empresa si pertenece a alguna de sus tiendas.
--
-- Los administradores pasan siempre, igual que ya ocurre en is_tienda_member.
-- Hoy los tres usuarios son administradores, así que esta función no les
-- restringe nada: lo que hace es cerrar la puerta a los usuarios no
-- administradores que se creen en el futuro. Cuando exista una segunda
-- empresa habrá que decidir si un administrador debe seguir viendo todo el
-- grupo o solo la suya, y esta es la función que hay que cambiar.
CREATE OR REPLACE FUNCTION public.es_miembro_empresa(_user_id UUID, _empresa_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tienda_usuarios tu
    JOIN public.tiendas t ON t.id = tu.tienda_id
    WHERE tu.user_id = _user_id AND t.empresa_id = _empresa_id
  ) OR public.has_role(_user_id, 'admin');
$$;

REVOKE EXECUTE ON FUNCTION public.es_miembro_empresa(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_miembro_empresa(UUID, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Las nueve tablas textil dejan de ser públicas para cualquier autenticado
-- ---------------------------------------------------------------------------

-- 2.a Tablas raíz: se filtran por su propia empresa_id.
DO $$
DECLARE
  v_tabla TEXT;
  v_raices TEXT[] := ARRAY[
    'textil_marcas', 'textil_stock', 'textil_clientes',
    'textil_presupuestos', 'textil_pedidos', 'textil_facturas'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_raices LOOP
    -- Las políticas viejas, por su nombre exacto tal como se crearon.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth all ' || v_tabla, v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth read marcas', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin write marcas', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth all stock', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || '_lectura', v_tabla);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.es_miembro_empresa(auth.uid(), empresa_id))',
      v_tabla || '_lectura', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || '_alta', v_tabla);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
      'WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id))',
      v_tabla || '_alta', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || '_modificacion', v_tabla);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
      'USING (public.es_miembro_empresa(auth.uid(), empresa_id)) '
      'WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id))',
      v_tabla || '_modificacion', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || '_borrado', v_tabla);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
      'USING (public.es_miembro_empresa(auth.uid(), empresa_id))',
      v_tabla || '_borrado', v_tabla);
  END LOOP;
END $$;

-- 2.b Tablas de línea: heredan la empresa por su clave foránea al padre.
DO $$
DECLARE
  v_lineas RECORD;
BEGIN
  FOR v_lineas IN
    SELECT * FROM (VALUES
      ('textil_presupuesto_items', 'presupuesto_id', 'textil_presupuestos'),
      ('textil_pedido_items',      'pedido_id',      'textil_pedidos'),
      ('textil_factura_items',     'factura_id',     'textil_facturas')
    ) AS t(tabla, columna, padre)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'auth all ' || v_lineas.tabla, v_lineas.tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      v_lineas.tabla || '_por_documento', v_lineas.tabla);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I '
      '               AND public.es_miembro_empresa(auth.uid(), p.empresa_id))) '
      'WITH CHECK (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I '
      '               AND public.es_miembro_empresa(auth.uid(), p.empresa_id)))',
      v_lineas.tabla || '_por_documento', v_lineas.tabla,
      v_lineas.padre, v_lineas.tabla, v_lineas.columna,
      v_lineas.padre, v_lineas.tabla, v_lineas.columna);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Una factura textil emitida no se borra
-- ---------------------------------------------------------------------------
-- deleteTextilFactura la borra hoy sin mirar el estado, y las líneas caen en
-- cascada. Esto lo impide en la base, que es donde tiene que estar: una regla
-- que solo vive en la interfaz no es una regla.
--
-- El borrado de borradores sigue permitido: un borrador no es un documento
-- fiscal.
CREATE OR REPLACE FUNCTION public.factura_emitida_no_se_borra()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(OLD.estado::TEXT, '') <> 'borrador' THEN
    RAISE EXCEPTION
      'La factura % está emitida y no se puede borrar. Emite una rectificativa o una anulación.',
      COALESCE(OLD.numero, OLD.id::TEXT);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS textil_facturas_no_borrar ON public.textil_facturas;
CREATE TRIGGER textil_facturas_no_borrar
  BEFORE DELETE ON public.textil_facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_emitida_no_se_borra();

-- ---------------------------------------------------------------------------
-- 4. Ninguna tabla nueva sin RLS
-- ---------------------------------------------------------------------------
-- Red de seguridad, no sustituto: sigue habiendo que escribir las políticas.
-- Una tabla con RLS activada y sin políticas no la lee nadie, que es
-- justamente el fallo que queremos, ruidoso y temprano.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS EVENT_TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT objid, schema_name, object_identity
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public'
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = r.objid AND c.relkind = 'r' AND NOT c.relrowsecurity
    ) THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.object_identity);
      RAISE NOTICE 'RLS activada automáticamente en %. Define ahora sus políticas.', r.object_identity;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS rls_auto_enable_trg;
CREATE EVENT TRIGGER rls_auto_enable_trg
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.rls_auto_enable();
