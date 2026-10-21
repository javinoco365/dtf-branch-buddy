-- ============================================================================
-- Niveles de usuario: admin, editor y visor
-- ============================================================================
-- Prueba 20261031200000 a 20261031200300, 20261031300200 (un desactivado no
-- ve ni escribe, tampoco si era admin) y 20261031300300 (marcar una compra
-- como borrada es borrar).
--
-- Lo que tiene que quedar demostrado: un visor no escribe por NINGÚN camino.
-- Los caminos son tres, y se prueban todos:
--
--   nav  el navegador: rol authenticated con su JWT. Decide la RLS.
--   srv  el servidor con adminComoUsuario(): rol de servicio y la cabecera
--        x-usuario-id. Se salta la RLS; decide la guardia.
--   def  una función SECURITY DEFINER que fija app.usuario_id. Se salta la
--        RLS; deciden la guardia y la comprobación al principio de la función.
--
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
-- En Supabase authenticated tiene permisos sobre storage.objects y deciden las
-- políticas; el entorno de pruebas no se los da.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- ---------------------------------------------------------------------------
-- Usuarios. ADM y ADM2 administradores, ED editor, VI visor, OFF editor
-- desactivado, ADMOFF administrador desactivado. INFO y VIEJO existen pero aún sin nivel: los coloca la
-- migración al volver a aplicarse.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-0000000000ad', 'adm@d1.test'),
  ('d1000000-0000-4000-8000-0000000000a2', 'adm2@d1.test'),
  ('d1000000-0000-4000-8000-0000000000ed', 'ed@d1.test'),
  ('d1000000-0000-4000-8000-0000000000f1', 'vi@d1.test'),
  ('d1000000-0000-4000-8000-0000000000ff', 'off@d1.test'),
  ('d1000000-0000-4000-8000-0000000000a0', 'admoff@d1.test'),
  ('d1000000-0000-4000-8000-00000000001f', 'Info@RonocaDesarrollos.com'),
  ('d1000000-0000-4000-8000-0000000000e1', 'viejo@d1.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d1000000-0000-4000-8000-0000000000ad', 'admin'),
  ('d1000000-0000-4000-8000-0000000000ed', 'editor'),
  ('d1000000-0000-4000-8000-0000000000f1', 'visor');
INSERT INTO public.user_roles (user_id, role, activo) VALUES
  ('d1000000-0000-4000-8000-0000000000ff', 'editor', false),
  ('d1000000-0000-4000-8000-0000000000a0', 'admin', false);

SELECT set_config('d1.adm',  'd1000000-0000-4000-8000-0000000000ad', true),
       set_config('d1.adm2', 'd1000000-0000-4000-8000-0000000000a2', true),
       set_config('d1.ed',   'd1000000-0000-4000-8000-0000000000ed', true),
       set_config('d1.vi',   'd1000000-0000-4000-8000-0000000000f1', true),
       set_config('d1.off',  'd1000000-0000-4000-8000-0000000000ff', true),
       set_config('d1.admoff','d1000000-0000-4000-8000-0000000000a0', true),
       set_config('d1.info', 'd1000000-0000-4000-8000-00000000001f', true),
       set_config('d1.viejo','d1000000-0000-4000-8000-0000000000e1', true);

-- ---------------------------------------------------------------------------
-- 0. Las migraciones, otra vez: se tienen que poder repetir, y la de datos
--    coloca a los usuarios que había.
-- ---------------------------------------------------------------------------
\ir ../migrations/20261031200000_roles_niveles.sql
\ir ../migrations/20261031200100_roles_permisos.sql
\ir ../migrations/20261031200200_roles_politicas_escritura.sql
\ir ../migrations/20261031200300_roles_funciones.sql
\ir ../migrations/20261031300200_roles_desactivado_sin_acceso.sql
\ir ../migrations/20261031300300_compras_borrado_solo_admin.sql
\ir ../migrations/20261031400000_niveles_lectura_total.sql

CREATE OR REPLACE FUNCTION pg_temp.informar(_etiqueta TEXT, _fallos TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v TEXT[] := array_remove(_fallos, NULL);
BEGIN
  IF cardinality(v) = 0 THEN
    RAISE NOTICE 'BIEN  %', _etiqueta;
  ELSE
    RAISE WARNING 'MAL   %: %', _etiqueta, array_to_string(v, '; ');
  END IF;
END $$;

-- Ejecuta _sql como _quien por el camino _via ('nav', 'srv' o 'def').
-- Devuelve las filas (o el count(*) de un SELECT), o «error» y el SQLSTATE.
-- Si falla, el bloque se deshace entero y rol, JWT y cabeceras vuelven atrás.
CREATE OR REPLACE FUNCTION pg_temp.como(_quien TEXT, _via TEXT, _sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT; v_id TEXT := current_setting('d1.' || _quien);
BEGIN
  IF _via = 'nav' THEN
    PERFORM set_config('request.jwt.claim.sub', v_id, true);
    SET LOCAL ROLE authenticated;
  ELSIF _via = 'srv' THEN
    PERFORM set_config('request.headers', json_build_object('x-usuario-id', v_id)::TEXT, true);
    SET LOCAL ROLE service_role;
  ELSE
    PERFORM set_config('app.usuario_id', v_id, true);
  END IF;
  IF _sql ~* '^\s*select' THEN
    EXECUTE _sql INTO v_n;
  ELSE
    EXECUTE _sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('app.usuario_id', '', true);
  RETURN v_n::TEXT;
EXCEPTION WHEN OTHERS THEN
  -- «permission denied for ...» también es 42501, pero no es un rechazo de
  -- nivel: no se cuenta como tal.
  IF SQLERRM LIKE 'permission denied%' THEN
    RETURN 'error de permisos de Postgres: ' || SQLERRM;
  END IF;
  RETURN 'error ' || SQLSTATE;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.caso(_que TEXT, _quien TEXT, _via TEXT, _sql TEXT, _esperado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT := pg_temp.como(_quien, _via, _sql);
BEGIN
  IF v = _esperado THEN RETURN NULL; END IF;
  RETURN _que || ' [' || _quien || '/' || _via || '] (esperaba ' || _esperado || ', salió ' || v || ')';
END $$;

-- ---------------------------------------------------------------------------
-- 1. Estructura y datos
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  IF enum_range(NULL::public.app_role)::TEXT <> '{admin,editor,visor}' THEN
    f := f || ('app_role es ' || enum_range(NULL::public.app_role)::TEXT);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_un_nivel_por_usuario' AND contype = 'u') THEN
    f := f || 'falta UNIQUE (user_id)'::TEXT;
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.user_roles'::regclass AND tgname = 'user_roles_queda_un_admin') <> 1 THEN
    f := f || 'falta o se repite el trigger del último admin'::TEXT;
  END IF;
  PERFORM pg_temp.informar('1a. app_role tiene admin, editor y visor; un nivel por usuario; trigger del último admin', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  IF public.rol_nivel(current_setting('d1.info')::UUID) IS DISTINCT FROM 'admin' THEN
    f := f || ('info@ es ' || coalesce(public.rol_nivel(current_setting('d1.info')::UUID)::TEXT, 'nada'));
  END IF;
  IF public.rol_nivel(current_setting('d1.viejo')::UUID) IS DISTINCT FROM 'editor' THEN
    f := f || ('el usuario sin nivel es ' || coalesce(public.rol_nivel(current_setting('d1.viejo')::UUID)::TEXT, 'nada'));
  END IF;
  IF public.rol_nivel(current_setting('d1.adm')::UUID) IS DISTINCT FROM 'admin'
     OR public.rol_nivel(current_setting('d1.vi')::UUID) IS DISTINCT FROM 'visor' THEN
    f := f || 'la migración ha cambiado el nivel de quien ya tenía uno'::TEXT;
  END IF;
  IF public.rol_nivel(current_setting('d1.off')::UUID) IS NOT NULL THEN
    f := f || 'el desactivado tiene nivel'::TEXT;
  END IF;
  PERFORM pg_temp.informar('1b. la migración deja admin a info@ (sin mirar mayúsculas), editor a quien no tenía nivel y no toca a los demás', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; r RECORD;
BEGIN
  -- Aplicadas dos veces: un solo trigger de guardia por tabla y la condición
  -- de nivel una sola vez por cláusula.
  FOR r IN
    SELECT tgrelid::regclass AS t, count(*) AS n FROM pg_trigger
     WHERE tgname = 'rol_guardia' GROUP BY 1 HAVING count(*) <> 1
  LOOP
    f := f || (r.t::TEXT || ' tiene ' || r.n || ' guardias');
  END LOOP;
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE (coalesce(qual, '') ~ 'SELECT (public\.)?rol_puede_.*SELECT (public\.)?rol_puede_')
        OR (coalesce(with_check, '') ~ 'SELECT (public\.)?rol_puede_.*SELECT (public\.)?rol_puede_')
  LOOP
    f := f || (r.tablename || ' «' || r.policyname || '» lleva la condición dos veces');
  END LOOP;
  PERFORM pg_temp.informar('1c. aplicadas dos veces: una guardia por tabla y la condición de nivel una sola vez', f);
END $$;

-- ---------------------------------------------------------------------------
-- 2. Tabla a tabla: todas las tablas de negocio tienen guardia, y todas sus
--    políticas de escritura exigen nivel
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}'; r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgfoid = 'public.auditoria_registrar'::regproc
       AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = 'rol_guardia')
  LOOP
    f := f || (r.relname || ' sin guardia');
  END LOOP;
  PERFORM pg_temp.informar('2a. todas las tablas auditadas tienen la guardia de niveles', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd FROM pg_policies
     WHERE schemaname IN ('public', 'storage')
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND tablename <> 'profiles'
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%rol_puede_%'
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%has_role(auth.uid(), ''admin''%'
       AND NOT (coalesce(qual, 'false') = 'false' AND coalesce(with_check, 'false') = 'false')
  LOOP
    f := f || (r.schemaname || '.' || r.tablename || ' «' || r.policyname || '» (' || r.cmd || ') no exige nivel');
  END LOOP;
  -- DELETE de entidades: solo admin. Las líneas, escribir.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND cmd = 'DELETE'
       AND coalesce(qual, '') LIKE '%rol_puede_escribir%'
       AND tablename NOT IN ('pedido_items', 'presupuesto_items', 'textil_presupuesto_items',
                             'textil_pedido_items', 'textil_compra_lineas', 'textil_stock_reservas',
                             'cliente_tiendas', 'enlaces_seguimiento')
  LOOP
    f := f || (r.tablename || ' «' || r.policyname || '» deja borrar a un editor');
  END LOOP;
  PERFORM pg_temp.informar('2b. toda política de escritura exige nivel (o admin); el borrado de entidades, admin', f);
END $$;

-- 2c. Una política de escritura sin nivel con otro nombre (creada a mano o
-- desde Lovable): 20261031200200 se para y dice cuál, en vez de avisar y
-- seguir (hallazgo SEG-REV-4). Se ejecuta el fichero tal como lo copia
-- probar-migraciones.sh (al lado del directorio de datos).
CREATE POLICY "D1 alta a mano" ON public.clientes FOR INSERT TO authenticated WITH CHECK (true);
DO $$
DECLARE
  v_sql TEXT;
  v_msg TEXT;
BEGIN
  v_sql := pg_read_file(regexp_replace(current_setting('data_directory'), '/data/?$', '')
                        || '/sql/20261031200200_roles_politicas_escritura.sql');
  BEGIN
    EXECUTE v_sql;
    RAISE WARNING 'MAL   2c. la migración se ha aplicado con una política de escritura sin nivel';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE 'roles_politicas_escritura: estas políticas de escritura no exigen nivel:%D1 alta a mano%' THEN
      RAISE NOTICE 'BIEN  2c. con una política de escritura sin nivel y otro nombre, se para y dice cuál';
    ELSE
      RAISE WARNING 'MAL   2c. se ha parado, pero con otro error: %', v_msg;
    END IF;
  END;
END $$;
DROP POLICY "D1 alta a mano" ON public.clientes;

-- ---------------------------------------------------------------------------
-- 3. Tabla a tabla, por los caminos que se saltan la RLS (srv y def).
--    Una sentencia que no toca ninguna fila basta: la guardia es por
--    sentencia y salta igual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.guardia_tabla_a_tabla(_quien TEXT, _via TEXT)
RETURNS TEXT[] LANGUAGE plpgsql AS $$
DECLARE
  f TEXT[] := '{}';
  r RECORD;
  v_ins TEXT; v_upd TEXT; v_del TEXT;
  e_ins TEXT; e_upd TEXT; e_del TEXT;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname,
           (regexp_match(pg_get_triggerdef(t.oid), 'rol_guardia\(''(\w+)''\)'))[1] AS clase,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               AND a.attgenerated = '' AND a.attidentity <> 'a'
             ORDER BY a.attnum LIMIT 1) AS col
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = 'rol_guardia'
     ORDER BY c.relname
  LOOP
    v_ins := format('INSERT INTO public.%I (%I) SELECT %I FROM public.%I WHERE false', r.relname, r.col, r.col, r.relname);
    v_upd := format('UPDATE public.%I SET %I = %I WHERE false', r.relname, r.col, r.col);
    v_del := format('DELETE FROM public.%I WHERE false', r.relname);

    IF _quien = 'adm' THEN
      e_ins := '0'; e_upd := '0'; e_del := '0';
    ELSIF _quien = 'ed' THEN
      e_ins := CASE WHEN r.clase = 'admin' THEN 'error 42501' ELSE '0' END;
      e_upd := e_ins;
      e_del := CASE WHEN r.clase = 'linea' THEN '0' ELSE 'error 42501' END;
    ELSE
      e_ins := 'error 42501'; e_upd := 'error 42501'; e_del := 'error 42501';
    END IF;

    f := f || pg_temp.caso(r.relname || ' INSERT', _quien, _via, v_ins, e_ins);
    f := f || pg_temp.caso(r.relname || ' UPDATE', _quien, _via, v_upd, e_upd);
    f := f || pg_temp.caso(r.relname || ' DELETE', _quien, _via, v_del, e_del);
  END LOOP;
  RETURN f;
END $$;

DO $$
BEGIN
  PERFORM pg_temp.informar('3a. visor por el servidor (adminComoUsuario): no crea, no cambia ni borra en NINGUNA tabla',
    pg_temp.guardia_tabla_a_tabla('vi', 'srv'));
  PERFORM pg_temp.informar('3b. visor dentro de una función SECURITY DEFINER (app.usuario_id): igual, en ninguna tabla',
    pg_temp.guardia_tabla_a_tabla('vi', 'def'));
  PERFORM pg_temp.informar('3c. usuario desactivado: igual que un visor, en ninguna tabla',
    pg_temp.guardia_tabla_a_tabla('off', 'srv'));
  PERFORM pg_temp.informar('3d. editor: crea y modifica en todas; borra solo líneas; usuarios y accesos, no',
    pg_temp.guardia_tabla_a_tabla('ed', 'srv'));
  PERFORM pg_temp.informar('3e. admin: todo en todas',
    pg_temp.guardia_tabla_a_tabla('adm', 'def'));
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  -- Sin nadie identificado (webhook, sincronización automática) no se exige.
  BEGIN
    SET LOCAL ROLE service_role;
    UPDATE public.pedidos SET numero = numero WHERE false;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    f := f || ('sin autor: ' || SQLERRM);
  END;
  PERFORM pg_temp.informar('3f. sin usuario identificado (webhook, sincronización) la guardia deja pasar, como antes', f);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Desde el navegador (RLS), con filas de verdad
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_t UUID; v_p UUID; v_k UUID; v_m UUID;
BEGIN
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda D1', 'tienda-d1') RETURNING id INTO v_t;
  INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES
    (v_t, current_setting('d1.ed')::UUID),
    (v_t, current_setting('d1.vi')::UUID),
    (v_t, current_setting('d1.off')::UUID);
  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_t, 'D1-1') RETURNING id INTO v_p;
  INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES (v_p, 'D1 línea');
  INSERT INTO public.clientes (nombre) VALUES ('Cliente D1') RETURNING id INTO v_k;
  INSERT INTO public.textil_marcas (nombre) VALUES ('Marca D1') RETURNING id INTO v_m;
  PERFORM set_config('d1.t', v_t::TEXT, true);
  PERFORM set_config('d1.p', v_p::TEXT, true);
  PERFORM set_config('d1.k', v_k::TEXT, true);
  PERFORM set_config('d1.m', v_m::TEXT, true);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; q TEXT;
BEGIN
  FOREACH q IN ARRAY ARRAY['vi', 'off'] LOOP
    -- El visor ve lo de su tienda; el desactivado, aunque siga en
    -- tienda_usuarios, ya no (20261031300200).
    f := f || pg_temp.caso('ve el pedido', q, 'nav', $s$SELECT count(*) FROM public.pedidos WHERE id = current_setting('d1.p')::uuid$s$, CASE q WHEN 'vi' THEN '1' ELSE '0' END);
    f := f || pg_temp.caso('ve la línea', q, 'nav', $s$SELECT count(*) FROM public.pedido_items WHERE pedido_id = current_setting('d1.p')::uuid$s$, CASE q WHEN 'vi' THEN '1' ELSE '0' END);
    f := f || pg_temp.caso('ve el cliente', q, 'nav', $s$SELECT count(*) FROM public.clientes WHERE id = current_setting('d1.k')::uuid$s$, CASE q WHEN 'vi' THEN '1' ELSE '0' END);
    f := f || pg_temp.caso('alta de pedido', q, 'nav', $s$INSERT INTO public.pedidos (tienda_id, numero) VALUES (current_setting('d1.t')::uuid, 'D1-V')$s$, 'error 42501');
    f := f || pg_temp.caso('edita el pedido', q, 'nav', $s$UPDATE public.pedidos SET notas = 'x' WHERE id = current_setting('d1.p')::uuid$s$, '0');
    f := f || pg_temp.caso('borra el pedido', q, 'nav', $s$DELETE FROM public.pedidos WHERE id = current_setting('d1.p')::uuid$s$, '0');
    f := f || pg_temp.caso('alta de línea', q, 'nav', $s$INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES (current_setting('d1.p')::uuid, 'x')$s$, 'error 42501');
    f := f || pg_temp.caso('edita la línea', q, 'nav', $s$UPDATE public.pedido_items SET descripcion = 'x' WHERE pedido_id = current_setting('d1.p')::uuid$s$, '0');
    f := f || pg_temp.caso('borra la línea', q, 'nav', $s$DELETE FROM public.pedido_items WHERE pedido_id = current_setting('d1.p')::uuid$s$, '0');
    f := f || pg_temp.caso('alta de cliente', q, 'nav', $s$INSERT INTO public.clientes (nombre) VALUES ('x')$s$, 'error 42501');
    f := f || pg_temp.caso('edita el cliente', q, 'nav', $s$UPDATE public.clientes SET nombre = 'x' WHERE id = current_setting('d1.k')::uuid$s$, '0');
    f := f || pg_temp.caso('borra el cliente', q, 'nav', $s$DELETE FROM public.clientes WHERE id = current_setting('d1.k')::uuid$s$, '0');
    f := f || pg_temp.caso('alta de marca', q, 'nav', $s$INSERT INTO public.textil_marcas (nombre) VALUES ('x')$s$, 'error 42501');
    f := f || pg_temp.caso('edita la marca', q, 'nav', $s$UPDATE public.textil_marcas SET nombre = 'x' WHERE id = current_setting('d1.m')::uuid$s$, '0');
    -- Políticas que eran «true» para cualquiera con sesión.
    f := f || pg_temp.caso('alta de movimiento de banco', q, 'nav', $s$INSERT INTO public.banco_movimientos (empresa_id, fecha, importe, huella) VALUES (public.empresa_por_defecto(), DATE '2026-10-01', 1, 'd1-vi')$s$, 'error 42501');
  END LOOP;
  PERFORM pg_temp.informar('4a. visor y desactivado, desde el navegador: el visor ve lo de su tienda, el desactivado nada; ninguno crea, cambia ni borra', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('alta de pedido', 'ed', 'nav', $s$INSERT INTO public.pedidos (tienda_id, numero) VALUES (current_setting('d1.t')::uuid, 'D1-E')$s$, '1');
  f := f || pg_temp.caso('edita el pedido', 'ed', 'nav', $s$UPDATE public.pedidos SET notas = 'editado' WHERE id = current_setting('d1.p')::uuid$s$, '1');
  f := f || pg_temp.caso('alta de línea', 'ed', 'nav', $s$INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES (current_setting('d1.p')::uuid, 'D1 otra')$s$, '1');
  f := f || pg_temp.caso('borra una línea (editar el pedido)', 'ed', 'nav', $s$DELETE FROM public.pedido_items WHERE pedido_id = current_setting('d1.p')::uuid AND descripcion = 'D1 otra'$s$, '1');
  f := f || pg_temp.caso('borra el pedido', 'ed', 'nav', $s$DELETE FROM public.pedidos WHERE id = current_setting('d1.p')::uuid$s$, '0');
  f := f || pg_temp.caso('alta de cliente', 'ed', 'nav', $s$INSERT INTO public.clientes (nombre) VALUES ('Cliente D1 editor')$s$, '1');
  f := f || pg_temp.caso('edita el cliente', 'ed', 'nav', $s$UPDATE public.clientes SET nombre = 'Cliente D1 bis' WHERE id = current_setting('d1.k')::uuid$s$, '1');
  f := f || pg_temp.caso('borra el cliente', 'ed', 'nav', $s$DELETE FROM public.clientes WHERE id = current_setting('d1.k')::uuid$s$, '0');
  f := f || pg_temp.caso('borra la marca', 'ed', 'nav', $s$DELETE FROM public.textil_marcas WHERE id = current_setting('d1.m')::uuid$s$, '0');
  f := f || pg_temp.caso('alta de movimiento de banco', 'ed', 'nav', $s$INSERT INTO public.banco_movimientos (empresa_id, fecha, importe, huella) VALUES (public.empresa_por_defecto(), DATE '2026-10-01', 1, 'd1-ed')$s$, '1');
  f := f || pg_temp.caso('se da acceso a una tienda', 'ed', 'nav', $s$INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES (current_setting('d1.t')::uuid, current_setting('d1.viejo')::uuid)$s$, 'error 42501');
  PERFORM pg_temp.informar('4b. editor, desde el navegador: crea y modifica, borra líneas al editar; no borra entidades ni da accesos', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('borra el cliente', 'adm', 'nav', $s$DELETE FROM public.clientes WHERE id = current_setting('d1.k')::uuid$s$, '1');
  f := f || pg_temp.caso('borra la marca', 'adm', 'nav', $s$DELETE FROM public.textil_marcas WHERE id = current_setting('d1.m')::uuid$s$, '1');
  f := f || pg_temp.caso('borra el pedido (y sus líneas en cascada)', 'adm', 'nav', $s$DELETE FROM public.pedidos WHERE id = current_setting('d1.p')::uuid$s$, '1');
  PERFORM pg_temp.informar('4c. admin, desde el navegador: borra', f);
END $$;

-- Un admin desactivado conserva role = 'admin' en user_roles. has_role() no
-- miraba activo, y las políticas que exigen has_role(auth.uid(), 'admin') le
-- seguían dejando escribir (hallazgo R1); mis_empresas() le daba todas
-- (SEG-REV-3). Mientras le dure el token no tiene que poder nada.
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  IF public.has_role(current_setting('d1.admoff')::UUID, 'admin') THEN
    f := f || 'has_role() del admin desactivado sigue siendo true'::TEXT;
  END IF;
  f := f || pg_temp.caso('mis_empresas() vacío', 'admoff', 'nav', $s$SELECT cardinality(public.mis_empresas())$s$, '0');
  f := f || pg_temp.caso('mis_tiendas() vacío', 'admoff', 'nav', $s$SELECT cardinality(public.mis_tiendas())$s$, '0');
  f := f || pg_temp.caso('ve la tienda', 'admoff', 'nav', $s$SELECT count(*) FROM public.tiendas WHERE id = current_setting('d1.t')::uuid$s$, '0');
  f := f || pg_temp.caso('lee la auditoría', 'admoff', 'nav', $s$SELECT count(*) FROM public.auditoria$s$, '0');
  f := f || pg_temp.caso('se da acceso a una tienda', 'admoff', 'nav', $s$INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES (current_setting('d1.t')::uuid, current_setting('d1.admoff')::uuid)$s$, 'error 42501');
  f := f || pg_temp.caso('renombra la tienda', 'admoff', 'nav', $s$UPDATE public.tiendas SET nombre = 'hackeada' WHERE id = current_setting('d1.t')::uuid$s$, '0');
  f := f || pg_temp.caso('borra la tienda', 'admoff', 'nav', $s$DELETE FROM public.tiendas WHERE id = current_setting('d1.t')::uuid$s$, '0');
  f := f || pg_temp.caso('sube al bucket compras', 'admoff', 'nav', $s$INSERT INTO storage.objects (bucket_id, name) VALUES ('compras', 'd1/admoff.pdf')$s$, 'error 42501');
  f := f || pg_temp.caso('sube un PDF de factura textil', 'admoff', 'nav', $s$INSERT INTO storage.objects (bucket_id, name) VALUES ('facturas', 'textil/d1-admoff.pdf')$s$, 'error 42501');
  -- Y el admin activo, igual que antes.
  f := f || pg_temp.caso('el admin activo ve la tienda', 'adm', 'nav', $s$SELECT count(*) FROM public.tiendas WHERE id = current_setting('d1.t')::uuid$s$, '1');
  f := f || pg_temp.caso('el admin activo sube al bucket compras', 'adm', 'nav', $s$INSERT INTO storage.objects (bucket_id, name) VALUES ('compras', 'd1/adm.pdf')$s$, '1');
  IF (SELECT nombre FROM public.tiendas WHERE id = current_setting('d1.t')::uuid) IS DISTINCT FROM 'Tienda D1' THEN
    f := f || 'la tienda ha cambiado'::TEXT;
  END IF;
  PERFORM pg_temp.informar('4d. admin desactivado, desde el navegador: no ve nada ni escribe en tiendas, tienda_usuarios ni storage; el activo sí', f);
END $$;

-- Marcar una compra como borrada (borrada_en) es un UPDATE para la base, pero
-- es borrar: solo admin (hallazgo R2).
DO $$
DECLARE f TEXT[] := '{}'; v_c UUID;
BEGIN
  INSERT INTO public.textil_compras (empresa_id, categoria, proveedor, numero)
  VALUES (public.empresa_por_defecto(), 'servicios', 'Proveedor D1', 'D1-C1') RETURNING id INTO v_c;
  PERFORM set_config('d1.c', v_c::TEXT, true);
  f := f || pg_temp.caso('el editor ve la compra', 'ed', 'nav', $s$SELECT count(*) FROM public.textil_compras WHERE id = current_setting('d1.c')::uuid$s$, '1');
  f := f || pg_temp.caso('el editor la edita', 'ed', 'nav', $s$UPDATE public.textil_compras SET proveedor = 'Proveedor D1 bis' WHERE id = current_setting('d1.c')::uuid$s$, '1');
  f := f || pg_temp.caso('el editor la marca como borrada', 'ed', 'nav', $s$UPDATE public.textil_compras SET borrada_en = now() WHERE id = current_setting('d1.c')::uuid$s$, 'error 42501');
  f := f || pg_temp.caso('el editor la marca como borrada por el servidor', 'ed', 'srv', $s$UPDATE public.textil_compras SET borrada_en = now() WHERE id = current_setting('d1.c')::uuid$s$, 'error 42501');
  IF (SELECT borrada_en FROM public.textil_compras WHERE id = v_c) IS NOT NULL THEN
    f := f || 'la compra ha quedado borrada'::TEXT;
  END IF;
  f := f || pg_temp.caso('el admin la marca como borrada', 'adm', 'nav', $s$UPDATE public.textil_compras SET borrada_en = now() WHERE id = current_setting('d1.c')::uuid$s$, '1');
  PERFORM pg_temp.informar('4e. marcar una compra como borrada es borrar: el editor no puede (ni por el navegador ni por el servidor); el admin sí', f);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Funciones SECURITY DEFINER
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}'; v TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'emitir_factura', 'emitir_factura_textil', 'anular_factura', 'factura_cambiar_estado_cobro',
    'serie_fijar_inicio', 'pedido_fijar_realizado', 'textil_compra_guardar_y_registrar',
    'textil_stock_fusionar', 'banco_conciliar', 'banco_desconciliar', 'banco_enlazar_como',
    'banco_desenlazar_como', 'banco_confirmar', 'banco_marcar_traspaso', 'banco_desmarcar_traspaso',
    'textil_compra_registrar', 'textil_pedido_entregar', 'siguiente_numero',
    'plantillas_correo_sembrar', 'factura_borrar_ultima', 'textil_stock_retirar',
    'smtp_guardar', 'smtp_borrar_tienda', 'tienda_credenciales_guardar'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = v AND pronamespace = 'public'::regnamespace
                     AND prosrc LIKE '%rol_exigir_quien(%') THEN
      f := f || (v || ' no comprueba el nivel');
    END IF;
  END LOOP;
  -- Ninguna otra SECURITY DEFINER que pueda llamar authenticated escribe sin comprobar.
  FOR v IN
    SELECT p.proname FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prokind = 'f'
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.prosrc ~* '(insert into|update public\.\w+\s+set|delete from)'
       AND p.prosrc NOT LIKE '%rol_exigir%'
  LOOP
    f := f || (v || ' la puede llamar el navegador, escribe y no comprueba el nivel');
  END LOOP;
  PERFORM pg_temp.informar('5a. las funciones SECURITY DEFINER que escriben comprueban el nivel en su primera línea', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; v_antes BIGINT; v_t UUID := current_setting('d1.t')::UUID;
BEGIN
  SELECT count(*) INTO v_antes FROM public.facturas;
  -- emitir_factura() la llama el servidor con el rol de servicio y _usuario_id.
  f := f || pg_temp.caso('emitir factura con _usuario_id visor', 'vi', 'srv', format($s$
    SELECT count(*) FROM (SELECT public.emitir_factura(
      _usuario_id => %L, _tienda_id => %L,
      _receptor => '{"nombre":"D1","nif":"12345678Z"}'::jsonb,
      _lineas => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
      _fecha => DATE '2038-01-15', _simplificada => true)) x$s$, current_setting('d1.vi'), v_t), 'error 42501');
  -- El navegador de un visor llama a una función con el _usuario_id de un admin.
  f := f || pg_temp.caso('conciliar haciéndose pasar por el admin', 'vi', 'nav', format($s$
    SELECT count(*) FROM (SELECT public.banco_conciliar(%L, gen_random_uuid(), gen_random_uuid())) x$s$,
    current_setting('d1.adm')), 'error 42501');
  f := f || pg_temp.caso('confirmar un enlace', 'vi', 'nav',
    $s$SELECT count(*) FROM (SELECT public.banco_confirmar(gen_random_uuid())) x$s$, 'error 42501');
  f := f || pg_temp.caso('numerar un presupuesto', 'vi', 'nav',
    $s$SELECT count(*) FROM (SELECT public.siguiente_numero(public.empresa_por_defecto(), 'presupuesto')) x$s$, 'error 42501');
  -- Borrar es de admin, también dentro de una función.
  f := f || pg_temp.caso('borrar la última factura', 'ed', 'nav',
    $s$SELECT count(*) FROM (SELECT public.factura_borrar_ultima('tienda', gen_random_uuid())) x$s$, 'error 42501');
  f := f || pg_temp.caso('retirar una variante de stock', 'ed', 'nav',
    $s$SELECT count(*) FROM (SELECT public.textil_stock_retirar(gen_random_uuid())) x$s$, 'error 42501');
  -- Las credenciales de WooCommerce, solo admin (por el servidor con autor).
  f := f || pg_temp.caso('guardar credenciales de WooCommerce', 'ed', 'srv', format($s$
    SELECT count(*) FROM (SELECT public.tienda_credenciales_guardar(%L, 'ck', 'cs')) x$s$, v_t), 'error 42501');
  -- Un editor sí numera.
  f := f || pg_temp.caso('el editor numera un presupuesto', 'ed', 'nav',
    $s$SELECT count(*) FROM (SELECT public.siguiente_numero(public.empresa_por_defecto(), 'presupuesto')) x$s$, '1');
  IF (SELECT count(*) FROM public.facturas) <> v_antes THEN
    f := f || 'se ha emitido una factura'::TEXT;
  END IF;
  PERFORM pg_temp.informar('5b. un visor no emite, no concilia aunque pase el id de un admin, no numera; un editor no borra ni toca credenciales', f);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Gestión de usuarios: usuario_fijar_nivel()
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}'; v_aud RECORD;
BEGIN
  -- Solo admin.
  f := f || pg_temp.caso('el editor cambia un nivel', 'ed', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'admin')) x$s$,
    current_setting('d1.ed'), current_setting('d1.ed')), 'error 42501');
  f := f || pg_temp.caso('el visor cambia un nivel', 'vi', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'admin')) x$s$,
    current_setting('d1.vi'), current_setting('d1.vi')), 'error 42501');
  -- El admin hace editor al visor, y queda auditado con su nombre.
  f := f || pg_temp.caso('el admin hace editor al visor', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'editor')) x$s$,
    current_setting('d1.adm'), current_setting('d1.vi')), '1');
  IF public.rol_nivel(current_setting('d1.vi')::UUID) IS DISTINCT FROM 'editor' THEN
    f := f || 'el visor no ha pasado a editor'::TEXT;
  END IF;
  SELECT * INTO v_aud FROM public.auditoria WHERE tabla = 'user_roles' ORDER BY id DESC LIMIT 1;
  IF v_aud.usuario_id IS DISTINCT FROM current_setting('d1.adm')::UUID THEN
    f := f || ('el cambio de nivel queda auditado a nombre de ' || coalesce(v_aud.usuario_id::TEXT, 'nadie'));
  END IF;
  -- Y lo vuelve a dejar en visor; luego desactiva y reactiva al editor desactivado.
  f := f || pg_temp.caso('vuelve a visor', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'visor')) x$s$,
    current_setting('d1.adm'), current_setting('d1.vi')), '1');
  f := f || pg_temp.caso('reactiva al desactivado', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'editor', true)) x$s$,
    current_setting('d1.adm'), current_setting('d1.off')), '1');
  IF public.rol_nivel(current_setting('d1.off')::UUID) IS DISTINCT FROM 'editor' THEN
    f := f || 'reactivado, no ha vuelto a editor'::TEXT;
  END IF;
  f := f || pg_temp.caso('lo vuelve a desactivar', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'editor', false)) x$s$,
    current_setting('d1.adm'), current_setting('d1.off')), '1');
  IF public.rol_nivel(current_setting('d1.off')::UUID) IS NOT NULL THEN
    f := f || 'desactivado, sigue con nivel'::TEXT;
  END IF;
  -- Nadie se desactiva a sí mismo.
  f := f || pg_temp.caso('el admin se desactiva', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'admin', false)) x$s$,
    current_setting('d1.adm'), current_setting('d1.adm')), 'error 42501');
  PERFORM pg_temp.informar('6a. solo un admin cambia niveles, activa y desactiva; queda auditado con su nombre; nadie se desactiva a sí mismo', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  -- Deja a ADM como único admin activo (los de otras pruebas, desactivados
  -- dentro de esta transacción).
  UPDATE public.user_roles SET activo = false
   WHERE role = 'admin' AND user_id <> current_setting('d1.adm')::UUID;

  f := f || pg_temp.caso('el último admin se baja a editor', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'editor')) x$s$,
    current_setting('d1.adm'), current_setting('d1.adm')), 'error 42501');
  f := f || pg_temp.caso('se borra la fila del último admin', 'adm', 'def',
    $s$DELETE FROM public.user_roles WHERE role = 'admin' AND activo$s$, 'error 42501');
  IF public.rol_nivel(current_setting('d1.adm')::UUID) IS DISTINCT FROM 'admin' THEN
    f := f || 'el último admin ha dejado de serlo'::TEXT;
  END IF;

  -- Con un segundo admin, sí puede bajarse.
  f := f || pg_temp.caso('nombra a otro admin', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'admin')) x$s$,
    current_setting('d1.adm'), current_setting('d1.adm2')), '1');
  f := f || pg_temp.caso('y ahora se baja a editor', 'adm', 'srv', format(
    $s$SELECT count(*) FROM (SELECT public.usuario_fijar_nivel(%L, %L, 'editor')) x$s$,
    current_setting('d1.adm'), current_setting('d1.adm')), '1');
  PERFORM pg_temp.informar('6b. siempre queda un admin activo: el último no se baja ni se borra; con otro, sí', f);
END $$;

DO $$
BEGIN
  IF public.mi_nivel() IS NULL THEN
    RAISE NOTICE 'BIEN  6c. mi_nivel() sin sesión es NULL';
  ELSE
    RAISE WARNING 'MAL   6c. mi_nivel() sin sesión devuelve %', public.mi_nivel();
  END IF;
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('mi_nivel del visor', 'vi', 'nav', $s$SELECT count(*) FROM (SELECT 1 WHERE public.mi_nivel() = 'visor') x$s$, '1');
  f := f || pg_temp.caso('mi_nivel del editor', 'ed', 'nav', $s$SELECT count(*) FROM (SELECT 1 WHERE public.mi_nivel() = 'editor') x$s$, '1');
  f := f || pg_temp.caso('mi_nivel del desactivado', 'off', 'nav', $s$SELECT count(*) FROM (SELECT 1 WHERE public.mi_nivel() IS NULL) x$s$, '1');
  f := f || pg_temp.caso('un visor no se cambia el nivel desde el navegador', 'vi', 'nav',
    $s$UPDATE public.user_roles SET role = 'admin' WHERE user_id = auth.uid()$s$, '0');
  f := f || pg_temp.caso('ni se da de alta como admin', 'viejo', 'nav',
    $s$INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'admin')$s$, 'error 42501');
  PERFORM pg_temp.informar('6d. mi_nivel() da el nivel de quien pregunta; user_roles no se toca desde el navegador', f);
END $$;

-- La cadena de auditoría sigue bien con todo lo de arriba.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  7. la cadena de auditoría sigue intacta'
            ELSE 'MAL   7. hay eslabones rotos en la auditoría' END
  FROM public.auditoria_verificar();

-- ---------------------------------------------------------------------------
-- 8. Las reversiones, en orden, dejan la base como antes de los niveles
-- ---------------------------------------------------------------------------
-- Primero las posteriores (400000, 300400, 300300 y 300200, que usan las funciones de
-- nivel y la columna activo; y seguridad, 20261031300000 y 300100): seis de sus
-- funciones llevan la línea de rol_exigir_quien() y hay que devolverlas al
-- cuerpo de 20261031200300 antes de quitar los niveles.
\ir ../reversiones/20261031400000_niveles_lectura_total.sql
\ir ../reversiones/20261031300400_seguridad_escritura_por_empresa.sql
\ir ../reversiones/20261031300300_compras_borrado_solo_admin.sql
\ir ../reversiones/20261031300200_roles_desactivado_sin_acceso.sql
\ir ../reversiones/20261031300100_seguridad_lectura_por_empresa.sql
\ir ../reversiones/20261031300000_seguridad_funciones_y_privilegios.sql
\ir ../reversiones/20261031200300_roles_funciones.sql
\ir ../reversiones/20261031200200_roles_politicas_escritura.sql
\ir ../reversiones/20261031200100_roles_permisos.sql

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('rol_guardia', 'user_roles_queda_un_admin')) THEN
    f := f || 'quedan triggers de niveles'::TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%rol_puede_%') THEN
    f := f || 'quedan políticas con la condición de nivel'::TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%rol_exigir%') THEN
    f := f || 'quedan funciones que llaman a rol_exigir'::TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('rol_nivel', 'rol_puede_escribir', 'rol_puede_borrar', 'rol_es_admin',
                               'mi_nivel', 'rol_exigir', 'rol_exigir_quien', 'rol_hay_admin_activo',
                               'rol_guardia', 'usuario_fijar_nivel', 'user_roles_queda_un_admin')) THEN
    f := f || 'quedan funciones de niveles'::TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.user_roles'::regclass AND attname = 'activo' AND NOT attisdropped) THEN
    f := f || 'queda la columna activo'::TEXT;
  END IF;
  -- Y la base sigue funcionando: un miembro escribe en su tienda como antes.
  IF pg_temp.como('ed', 'nav', $s$INSERT INTO public.pedidos (tienda_id, numero) VALUES (current_setting('d1.t')::uuid, 'D1-R')$s$) <> '1' THEN
    f := f || 'tras revertir, un miembro de la tienda no da de alta un pedido'::TEXT;
  END IF;
  PERFORM pg_temp.informar('8. las reversiones quitan triggers, condiciones, comprobaciones, funciones y columna; la base sigue funcionando', f);
END $$;

ROLLBACK;
