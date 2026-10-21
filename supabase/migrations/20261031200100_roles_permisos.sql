-- ============================================================================
-- Niveles de usuario (2 de 4): quién puede escribir, quién borrar, y la guardia
-- ============================================================================
--
-- EL MODELO
--   Cada usuario tiene UN nivel en user_roles: admin, editor o visor.
--
--     admin   todo, incluida la gestión de usuarios.
--     editor  ve todo, crea y modifica; no borra ni gestiona usuarios.
--     visor   solo ve: no crea, no cambia, no borra.
--
--   Un usuario sin fila en user_roles, o con la fila desactivada, no escribe
--   nada (se deniega por defecto). Desactivar no borra al usuario: su rastro
--   en la auditoría se conserva.
--
--   «Borrar» es borrar una entidad (un pedido, un cliente, un apunte, una
--   factura). Las líneas de un documento que se reescriben al editarlo
--   (pedido_items, presupuesto_items, ...) se borran como parte de la edición:
--   eso lo puede hacer un editor. La lista está en la sección 6.
--
-- QUÉ HACE
--   1. user_roles: una fila por usuario (UNIQUE (user_id)) y la columna
--      activo. Hoy solo existe el valor 'admin', así que (user_id, role) ya
--      era única por usuario y la restricción nueva no puede fallar.
--   2. Datos: info@ronocadesarrollos.com queda admin si existe; TODOS los demás
--      usuarios que no tenían fila pasan a editor, que es lo que podían hacer
--      hasta hoy (escribir en sus tiendas). Nadie pierde permisos.
--   3. Funciones: rol_nivel(), rol_puede_escribir(), rol_puede_borrar(),
--      rol_es_admin(), mi_nivel(), rol_exigir(), rol_exigir_quien() y
--      rol_hay_admin_activo(). STABLE y SECURITY DEFINER,
--      para que las políticas las llamen envueltas en (SELECT ...) y se
--      evalúen una vez por sentencia.
--   4. usuario_fijar_nivel(): la única forma de cambiar el nivel o activar y
--      desactivar a alguien. Comprueba que quien lo hace es admin y fija
--      app.usuario_id para la auditoría.
--   5. Siempre queda al menos un admin activo: un trigger lo impone en
--      user_roles, venga el cambio de donde venga.
--   6. La guardia: un trigger POR SENTENCIA en cada tabla de negocio que
--      comprueba el nivel de quien escribe cuando la RLS no se aplica. Cubre
--      los caminos que las políticas no ven: las funciones SECURITY DEFINER (que fijan app.usuario_id con el
--      _usuario_id que reciben) y el cliente de servicio con autor
--      (adminComoUsuario, cabecera x-usuario-id). Comprueba a la vez auth.uid()
--      y el autor de auditoria_autor(), así que pasar el _usuario_id de otro
--      no sirve para colarse. Sin ningún usuario identificado (webhooks,
--      sincronizaciones automáticas, migraciones) no hay a quién comprobar y
--      deja pasar, como hasta hoy.
--
--   Las políticas de escritura (INSERT/UPDATE/DELETE) van en 20261031200200 y
--   las comprobaciones explícitas de las funciones SECURITY DEFINER en
--   20261031200300. Las de lectura (SELECT) no se tocan.
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031200100_roles_permisos.sql
-- (quita guardia, funciones, restricción y columna; las filas de user_roles
-- nuevas se quedan: son datos y se borran solo con permiso).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. user_roles: un nivel por usuario, y activo
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_roles'::regclass AND conname = 'user_roles_un_nivel_por_usuario'
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_un_nivel_por_usuario UNIQUE (user_id);
  END IF;
END $$;

COMMENT ON COLUMN public.user_roles.role IS
  'Nivel del usuario: admin (todo), editor (ve, crea y modifica; no borra ni gestiona usuarios), visor (solo ve).';
COMMENT ON COLUMN public.user_roles.activo IS
  'false = desactivado: no escribe nada. Se desactiva en vez de borrar para conservar la auditoría.';

-- ---------------------------------------------------------------------------
-- 3. Funciones de nivel
-- ---------------------------------------------------------------------------
-- El nivel efectivo: NULL si no tiene fila o está desactivado.
CREATE OR REPLACE FUNCTION public.rol_nivel(_user_id UUID)
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.role FROM public.user_roles r
   WHERE r.user_id = _user_id AND r.activo
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rol_puede_escribir(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.rol_nivel(_user_id) IN ('admin', 'editor'), false)
$$;

CREATE OR REPLACE FUNCTION public.rol_puede_borrar(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.rol_nivel(_user_id) = 'admin', false)
$$;

CREATE OR REPLACE FUNCTION public.rol_es_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.rol_nivel(_user_id) = 'admin', false)
$$;

-- El nivel de quien pregunta: lo usan la interfaz y el middleware de permisos.
CREATE OR REPLACE FUNCTION public.mi_nivel()
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.rol_nivel(auth.uid())
$$;

-- Corta con un error legible si _user_id no puede hacer _accion
-- ('escribir', 'borrar' o 'admin'). Sin usuario (NULL) no hay a quién
-- comprobar: es el sistema (webhook, sincronización, migración).
CREATE OR REPLACE FUNCTION public.rol_exigir(_user_id UUID, _accion TEXT)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nivel public.app_role;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  IF _accion NOT IN ('escribir', 'borrar', 'admin') THEN
    RAISE EXCEPTION 'rol_exigir: acción desconocida «%»', _accion;
  END IF;

  v_nivel := public.rol_nivel(_user_id);
  IF v_nivel = 'admin' OR (_accion = 'escribir' AND v_nivel = 'editor') THEN
    RETURN;
  END IF;

  IF v_nivel IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no tiene nivel de acceso o está desactivado: no puede cambiar datos'
      USING ERRCODE = '42501';
  ELSIF _accion = 'escribir' THEN
    RAISE EXCEPTION 'Tu nivel (%) solo permite ver: no puedes crear ni modificar datos', v_nivel
      USING ERRCODE = '42501';
  ELSIF _accion = 'borrar' THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar (tu nivel: %)', v_nivel
      USING ERRCODE = '42501';
  ELSE
    RAISE EXCEPTION 'Solo un administrador puede hacer esto (tu nivel: %)', v_nivel
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rol_nivel(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rol_puede_escribir(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rol_puede_borrar(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rol_es_admin(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mi_nivel() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rol_exigir(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rol_nivel(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rol_puede_escribir(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rol_puede_borrar(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rol_es_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mi_nivel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rol_exigir(UUID, TEXT) TO authenticated, service_role;

-- Igual que rol_exigir(), pero con TODOS los que se identifican en la llamada:
-- el _usuario_id que recibe una función, el usuario del JWT (auth.uid()) y el
-- autor de auditoria_autor() (app.usuario_id o la cabecera x-usuario-id de
-- adminComoUsuario). Pasar el _usuario_id de un admin desde una sesión de
-- visor no cuela. Sin ninguno (webhook, sincronización automática), pasa.
CREATE OR REPLACE FUNCTION public.rol_exigir_quien(_usuario_id UUID, _accion TEXT)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jwt UUID;
  v_autor UUID;
BEGIN
  BEGIN
    v_jwt := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_jwt := NULL;
  END;
  v_autor := public.auditoria_autor();

  PERFORM public.rol_exigir(_usuario_id, _accion);
  IF v_jwt IS DISTINCT FROM _usuario_id THEN
    PERFORM public.rol_exigir(v_jwt, _accion);
  END IF;
  IF v_autor IS DISTINCT FROM _usuario_id AND v_autor IS DISTINCT FROM v_jwt THEN
    PERFORM public.rol_exigir(v_autor, _accion);
  END IF;
END;
$$;

-- ¿Hay algún admin activo? Mientras no lo haya (alta del primero) no se
-- exige ser admin para dar niveles.
CREATE OR REPLACE FUNCTION public.rol_hay_admin_activo()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin' AND activo)
$$;

REVOKE EXECUTE ON FUNCTION public.rol_exigir_quien(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rol_hay_admin_activo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rol_exigir_quien(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rol_hay_admin_activo() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Siempre queda un admin activo
-- ---------------------------------------------------------------------------
-- Después de cambiar o quitar una fila de admin activo, tiene que quedar otro.
-- También frena borrar en auth.users al último admin (la fila se va en cascada).
CREATE OR REPLACE FUNCTION public.user_roles_queda_un_admin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.activo
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin' AND activo) THEN
    RAISE EXCEPTION 'Tiene que quedar al menos un administrador activo'
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_queda_un_admin ON public.user_roles;
CREATE TRIGGER user_roles_queda_un_admin
  AFTER UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_queda_un_admin();

-- ---------------------------------------------------------------------------
-- 6. La guardia
-- ---------------------------------------------------------------------------
-- Argumento del trigger:
--   'escribir' (o nada)  INSERT/UPDATE exigen escribir; DELETE exige borrar.
--   'linea'              las tres exigen escribir: son líneas que se
--                        reescriben al editar su documento.
--   'admin'              las tres exigen admin (usuarios y accesos). Mientras
--                        no exista ningún admin activo no se exige, para que
--                        el alta del primero (bootstrapPrimerAdmin) funcione.
-- Es SECURITY INVOKER a propósito: row_security_active() tiene que mirar al
-- usuario que escribe, no al dueño de la función.
CREATE OR REPLACE FUNCTION public.rol_guardia()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_clase TEXT := COALESCE(TG_ARGV[0], 'escribir');
  v_accion TEXT;
BEGIN
  -- Si la RLS se aplica a quien escribe (authenticated desde el navegador o
  -- con context.supabase), deciden las políticas de 20261031200200, que ya
  -- exigen el nivel. La guardia es para los caminos que se saltan la RLS: las
  -- funciones SECURITY DEFINER y el rol de servicio.
  IF row_security_active(TG_RELID) THEN
    RETURN NULL;
  END IF;
  -- Escrituras anidadas (las hace otro trigger o un ON DELETE CASCADE) son
  -- consecuencia de una sentencia que ya pasó por aquí o por la RLS: borrar
  -- un pedido que se podía borrar arrastra sus líneas y sus cobros.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  v_accion := CASE
    WHEN v_clase = 'admin' THEN 'admin'
    WHEN TG_OP = 'DELETE' AND v_clase <> 'linea' THEN 'borrar'
    ELSE 'escribir'
  END;

  -- rol_hay_admin_activo() y rol_exigir_quien() son SECURITY DEFINER: esta
  -- función no lo es y quien escribe no siempre puede leer user_roles ni
  -- llamar a auditoria_autor().
  IF v_accion = 'admin' AND NOT public.rol_hay_admin_activo() THEN
    RETURN NULL;
  END IF;

  -- Sin nadie identificado (webhook, sincronización, migración) no exige nada.
  PERFORM public.rol_exigir_quien(NULL, v_accion);
  RETURN NULL;
END;
$$;


DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- Usuarios y accesos: solo admin.
      ('user_roles', 'admin'),
      ('tienda_usuarios', 'admin'),
      -- Líneas que se reescriben al editar su documento.
      ('pedido_items', 'linea'),
      ('presupuesto_items', 'linea'),
      ('textil_presupuesto_items', 'linea'),
      ('textil_pedido_items', 'linea'),
      ('textil_compra_lineas', 'linea'),
      ('textil_stock_reservas', 'linea'),
      ('factura_items', 'linea'),
      ('textil_factura_items', 'linea'),
      ('banco_conciliaciones', 'linea'),
      ('cliente_tiendas', 'linea'),
      ('enlaces_seguimiento', 'linea'),
      -- Entidades: crear y modificar, editor; borrar, admin.
      ('banco_cuentas', 'escribir'),
      ('banco_extractos', 'escribir'),
      ('banco_movimientos', 'escribir'),
      ('caja_conceptos', 'escribir'),
      ('caja_movimientos', 'escribir'),
      ('caja_socios', 'escribir'),
      ('clientes', 'escribir'),
      ('cobros', 'escribir'),
      ('contadores', 'escribir'),
      ('empresas', 'escribir'),
      ('facturas', 'escribir'),
      ('gerencia_ajustes', 'escribir'),
      ('gerencia_gastos_fijos', 'escribir'),
      ('gerencia_objetivos', 'escribir'),
      ('inversion_movimientos', 'escribir'),
      ('pedido_correos_enviados', 'escribir'),
      ('pedido_devoluciones', 'escribir'),
      ('pedidos', 'escribir'),
      ('plantillas_presupuesto', 'escribir'),
      ('presupuesto_imagenes', 'escribir'),
      ('presupuestos', 'escribir'),
      ('productos', 'escribir'),
      ('proveedores', 'escribir'),
      ('series_facturacion', 'escribir'),
      ('smtp_config', 'escribir'),
      ('textil_clientes', 'escribir'),
      ('textil_cobros', 'escribir'),
      ('textil_compras', 'escribir'),
      ('textil_facturas', 'escribir'),
      ('textil_marcas', 'escribir'),
      ('textil_pedidos', 'escribir'),
      ('textil_presupuestos', 'escribir'),
      ('textil_productos', 'escribir'),
      ('textil_referencias_proveedor', 'escribir'),
      ('textil_stock', 'escribir'),
      ('textil_stock_movimientos', 'escribir'),
      ('tienda_credenciales', 'escribir'),
      ('tienda_plantillas_correo', 'escribir'),
      ('tienda_seguimiento_config', 'escribir'),
      ('tiendas', 'escribir'),
      ('empresa_global', 'escribir')
    ) AS t(tabla, clase)
  LOOP
    -- Si una tabla no existe (base a medias), se salta en vez de fallar.
    IF to_regclass('public.' || r.tabla) IS NULL THEN
      RAISE NOTICE 'rol_guardia: la tabla % no existe, se salta', r.tabla;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS rol_guardia ON public.%I', r.tabla);
    EXECUTE format(
      'CREATE TRIGGER rol_guardia BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.rol_guardia(%L)',
      r.tabla, r.clase);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Datos: nadie pierde permisos y info@ queda admin
-- ---------------------------------------------------------------------------
-- Va después de la guardia a propósito: en una migración no hay usuario
-- identificado y la guardia deja pasar, igual que antes de crearla.
--
-- Primero info@, para que el alta de editores de abajo no le adelante.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'
  FROM auth.users u
 WHERE lower(u.email) = 'info@ronocadesarrollos.com'
ON CONFLICT DO NOTHING;

-- Los que hoy no tienen fila escriben en sus tiendas: pasan a editor.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'editor'
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. usuario_fijar_nivel(): cambiar el nivel o activar/desactivar
-- ---------------------------------------------------------------------------
-- La llama la server function de Ajustes > Usuarios con el cliente de
-- servicio. _usuario_id es quien lo hace (tiene que ser admin activo) y
-- _objetivo el usuario que cambia. Crea la fila si no la tenía.
CREATE OR REPLACE FUNCTION public.usuario_fijar_nivel(
  _usuario_id UUID,
  _objetivo UUID,
  _nivel public.app_role,
  _activo BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila public.user_roles%ROWTYPE;
BEGIN
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Falta quién hace el cambio';
  END IF;
  -- Mientras no haya admins (arranque) no hay a quién exigírselo.
  IF public.rol_hay_admin_activo() THEN
    PERFORM public.rol_exigir_quien(_usuario_id, 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _objetivo) THEN
    RAISE EXCEPTION 'Ese usuario no existe';
  END IF;
  IF _usuario_id = _objetivo AND NOT COALESCE(_activo, true) THEN
    RAISE EXCEPTION 'No puedes desactivarte a ti mismo' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  INSERT INTO public.user_roles (user_id, role, activo)
  VALUES (_objetivo, _nivel, COALESCE(_activo, true))
  ON CONFLICT (user_id) DO UPDATE
     SET role = EXCLUDED.role, activo = EXCLUDED.activo
   WHERE user_roles.role IS DISTINCT FROM EXCLUDED.role
      OR user_roles.activo IS DISTINCT FROM EXCLUDED.activo;

  SELECT * INTO v_fila FROM public.user_roles WHERE user_id = _objetivo;
  RETURN jsonb_build_object('user_id', v_fila.user_id, 'nivel', v_fila.role, 'activo', v_fila.activo);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.usuario_fijar_nivel(UUID, UUID, public.app_role, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usuario_fijar_nivel(UUID, UUID, public.app_role, BOOLEAN)
  TO service_role;

NOTIFY pgrst, 'reload schema';
