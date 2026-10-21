-- ============================================================================
-- Niveles: el editor y el visor lo ven TODO, salvo secretos
-- ============================================================================
-- Prueba 20261031400000_niveles_lectura_total.sql.
--
-- Lo que tiene que quedar demostrado:
--   - un visor (y un editor) SIN ninguna tienda asignada ve, tabla a tabla,
--     exactamente las mismas filas que un admin, con los datos que han dejado
--     las pruebas anteriores;
--   - no ve los secretos (credenciales de WooCommerce, SMTP, intentos de
--     acceso) ni las filas de auditoría de esas tablas;
--   - el visor no escribe en NINGUNA tabla desde el navegador, con filas de
--     verdad (las guardias de los otros dos caminos las prueba D1);
--   - un desactivado sigue sin ver nada, y quien no tiene nivel (alta a
--     medias) solo ve lo de sus tiendas asignadas;
--   - la reversión deja la lectura como antes y se puede volver a aplicar.
--
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

-- En Supabase authenticated tiene permisos sobre storage.objects y deciden las
-- políticas; el entorno de pruebas no se los da.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- Por si la base de pruebas llega sin tiendas: una, con un pedido, para que
-- la de «sin nivel» tenga algo que ver.
DO $$
DECLARE v_emp UUID; v_tienda UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tienda FROM public.tiendas ORDER BY created_at LIMIT 1;
  IF v_tienda IS NULL THEN
    INSERT INTO public.tiendas (nombre, empresa_id) VALUES ('D2 tienda', v_emp)
    RETURNING id INTO v_tienda;
  END IF;
  PERFORM set_config('d2.tienda', v_tienda::TEXT, true);
END $$;

INSERT INTO storage.objects (bucket_id, name) VALUES ('facturas', 'textil/d2-prueba.pdf');

-- ---------------------------------------------------------------------------
-- Usuarios. ADM admin, ED editor y VI visor sin ninguna tienda, OFF visor
-- desactivado con una tienda, SIN sin nivel con una tienda.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('d2000000-0000-4000-8000-0000000000ad', 'adm@d2.test'),
  ('d2000000-0000-4000-8000-0000000000ed', 'ed@d2.test'),
  ('d2000000-0000-4000-8000-0000000000f1', 'vi@d2.test'),
  ('d2000000-0000-4000-8000-0000000000ff', 'off@d2.test'),
  ('d2000000-0000-4000-8000-0000000000e0', 'sin@d2.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('d2000000-0000-4000-8000-0000000000ad', 'admin'),
  ('d2000000-0000-4000-8000-0000000000ed', 'editor'),
  ('d2000000-0000-4000-8000-0000000000f1', 'visor');
INSERT INTO public.user_roles (user_id, role, activo) VALUES
  ('d2000000-0000-4000-8000-0000000000ff', 'visor', false);
INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES
  (current_setting('d2.tienda')::UUID, 'd2000000-0000-4000-8000-0000000000ff'),
  (current_setting('d2.tienda')::UUID, 'd2000000-0000-4000-8000-0000000000e0');

SELECT set_config('d2.adm', 'd2000000-0000-4000-8000-0000000000ad', true),
       set_config('d2.ed',  'd2000000-0000-4000-8000-0000000000ed', true),
       set_config('d2.vi',  'd2000000-0000-4000-8000-0000000000f1', true),
       set_config('d2.off', 'd2000000-0000-4000-8000-0000000000ff', true),
       set_config('d2.sin', 'd2000000-0000-4000-8000-0000000000e0', true);

-- Varias pruebas anteriores vuelven a aplicar migraciones viejas fuera de su
-- transacción (C5, C18, C19...) y con eso recrean políticas de escritura sin
-- la condición de nivel. En producción las migraciones van en orden una vez:
-- aquí se vuelven a aplicar las que dejan las políticas como quedan, y la de
-- esta prueba dos veces (se tiene que poder repetir).
SET client_min_messages = warning;
\ir ../migrations/20261031200200_roles_politicas_escritura.sql
\ir ../migrations/20261031300300_compras_borrado_solo_admin.sql
\ir ../migrations/20261031300400_seguridad_escritura_por_empresa.sql
\ir ../migrations/20261031400000_niveles_lectura_total.sql
\ir ../migrations/20261031400000_niveles_lectura_total.sql
RESET client_min_messages;

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

-- Ejecuta _sql desde el navegador (rol authenticated con el JWT de _quien).
-- Devuelve el count(*) de un SELECT o las filas tocadas, o «error» y el
-- SQLSTATE. Una escritura se deshace SIEMPRE (sale con una excepción propia,
-- D2FIL, que lleva las filas): así una que pasa no cambia los datos con los
-- que se prueba lo siguiente. Rol y JWT vuelven atrás con el bloque.
CREATE OR REPLACE FUNCTION pg_temp.como(_quien TEXT, _sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('d2.' || _quien), true);
  SET LOCAL ROLE authenticated;
  IF _sql ~* '^\s*select' THEN
    EXECUTE _sql INTO v_n;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN v_n::TEXT;
  END IF;
  EXECUTE _sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE EXCEPTION USING ERRCODE = 'D2FIL', MESSAGE = v_n::TEXT;
EXCEPTION
  WHEN SQLSTATE 'D2FIL' THEN RETURN SQLERRM;
  WHEN OTHERS THEN RETURN 'error ' || SQLSTATE;
END $$;

-- Las tablas con RLS de public, salvo los secretos y auditoria (aparte).
CREATE TEMP TABLE d2_tablas ON COMMIT DROP AS
SELECT c.relname::TEXT AS tabla
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
   AND c.relname NOT IN ('tienda_credenciales', 'smtp_config', 'auth_intentos_fallidos_login',
                         'auditoria');

-- ---------------------------------------------------------------------------
-- 1. Funciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  IF NOT public.rol_puede_ver(current_setting('d2.vi')::UUID) THEN f := f || 'el visor no ve'::TEXT; END IF;
  IF NOT public.rol_puede_ver(current_setting('d2.ed')::UUID) THEN f := f || 'el editor no ve'::TEXT; END IF;
  IF public.rol_puede_ver(current_setting('d2.off')::UUID) THEN f := f || 'el desactivado ve'::TEXT; END IF;
  IF public.rol_puede_ver(current_setting('d2.sin')::UUID) THEN f := f || 'el que no tiene nivel ve todo'::TEXT; END IF;
  IF NOT public.is_tienda_member(current_setting('d2.vi')::UUID, current_setting('d2.tienda')::UUID) THEN
    f := f || 'is_tienda_member: el visor sin tiendas no es de la tienda'::TEXT;
  END IF;
  IF public.is_tienda_member(current_setting('d2.off')::UUID, current_setting('d2.tienda')::UUID) THEN
    f := f || 'is_tienda_member: el desactivado sigue siendo de su tienda'::TEXT;
  END IF;
  IF NOT public.is_tienda_member(current_setting('d2.sin')::UUID, current_setting('d2.tienda')::UUID) THEN
    f := f || 'is_tienda_member: el que no tiene nivel ya no es de su tienda'::TEXT;
  END IF;
  IF has_function_privilege('anon', 'public.rol_puede_ver(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rol_ve_empresa(uuid, uuid)', 'EXECUTE') THEN
    f := f || 'anon ejecuta las funciones nuevas'::TEXT;
  END IF;
  PERFORM pg_temp.informar('1. rol_puede_ver() e is_tienda_member(): nivel activo sí; desactivado no; sin nivel, sus tiendas', f);
END $$;

-- ---------------------------------------------------------------------------
-- 2. Lectura, tabla a tabla, con los datos de verdad
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}'; g TEXT[] := '{}'; r RECORD; v_adm TEXT; v_vi TEXT; v_ed TEXT;
        v_con_filas INT := 0;
BEGIN
  FOR r IN SELECT tabla FROM d2_tablas ORDER BY tabla LOOP
    v_adm := pg_temp.como('adm', format('SELECT count(*) FROM public.%I', r.tabla));
    v_vi  := pg_temp.como('vi',  format('SELECT count(*) FROM public.%I', r.tabla));
    v_ed  := pg_temp.como('ed',  format('SELECT count(*) FROM public.%I', r.tabla));
    IF v_vi IS DISTINCT FROM v_adm THEN
      f := f || (r.tabla || ': visor ' || v_vi || ', admin ' || v_adm);
    END IF;
    IF v_ed IS DISTINCT FROM v_adm THEN
      g := g || (r.tabla || ': editor ' || v_ed || ', admin ' || v_adm);
    END IF;
    IF v_adm ~ '^[0-9]+$' AND v_adm::INT > 0 THEN v_con_filas := v_con_filas + 1; END IF;
  END LOOP;
  IF v_con_filas < 20 THEN
    f := f || ('solo ' || v_con_filas || ' tablas con filas: la prueba no demuestra nada')::TEXT;
  END IF;
  PERFORM pg_temp.informar(format('2a. el visor sin tiendas ve las mismas filas que el admin en las %s tablas (%s con filas)',
    (SELECT count(*) FROM d2_tablas), v_con_filas), f);
  PERFORM pg_temp.informar('2b. el editor sin tiendas, también', g);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; v TEXT;
BEGIN
  v := pg_temp.como('vi', $q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'facturas' AND name LIKE 'textil/%'$q$);
  IF v = '0' OR v LIKE 'error%' THEN f := f || ('PDF textil: ' || v); END IF;
  v := pg_temp.como('off', $q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'facturas' AND name LIKE 'textil/%'$q$);
  IF v <> '0' THEN f := f || ('el desactivado ve PDF textil: ' || v); END IF;
  PERFORM pg_temp.informar('2c. el visor abre los PDF de las facturas textil; el desactivado no', f);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Secretos y auditoría
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}'; v TEXT; v_esperado BIGINT; v_adm TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY['tienda_credenciales', 'smtp_config', 'auth_intentos_fallidos_login'] LOOP
    IF pg_temp.como('vi', format('SELECT count(*) FROM public.%I', v)) <> '0'
       AND pg_temp.como('vi', format('SELECT count(*) FROM public.%I', v)) NOT LIKE 'error%' THEN
      f := f || (v || ': el visor ve ' || pg_temp.como('vi', format('SELECT count(*) FROM public.%I', v)));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_esperado FROM public.auditoria
   WHERE tabla NOT IN ('smtp_config', 'tienda_credenciales');
  v_adm := pg_temp.como('adm', 'SELECT count(*) FROM public.auditoria');
  IF v_adm <> (SELECT count(*) FROM public.auditoria)::TEXT THEN
    f := f || ('el admin no ve toda la auditoría: ' || v_adm);
  END IF;
  IF pg_temp.como('vi', 'SELECT count(*) FROM public.auditoria') <> v_esperado::TEXT THEN
    f := f || ('el visor ve ' || pg_temp.como('vi', 'SELECT count(*) FROM public.auditoria')
               || ' filas de auditoría; tendría que ver ' || v_esperado);
  END IF;
  IF pg_temp.como('vi', $q$SELECT count(*) FROM public.auditoria WHERE tabla IN ('smtp_config', 'tienda_credenciales')$q$) <> '0' THEN
    f := f || 'el visor ve la auditoría de las credenciales o del SMTP'::TEXT;
  END IF;
  IF (SELECT count(*) FROM public.auditoria) = 0 THEN
    f := f || 'no hay auditoría: la prueba no demuestra nada'::TEXT;
  END IF;
  PERFORM pg_temp.informar('3. el visor no ve credenciales, SMTP ni intentos de acceso; la auditoría, toda salvo la de esos secretos', f);
END $$;

-- ---------------------------------------------------------------------------
-- 4. El visor no escribe en ninguna tabla desde el navegador, con filas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f TEXT[] := '{}'; r RECORD; v TEXT; v_cols TEXT;
BEGIN
  -- profiles, aparte: cada uno cambia su propio perfil (nombre), sea cual sea
  -- su nivel. El de los demás, no.
  FOR r IN SELECT tabla FROM d2_tablas WHERE tabla <> 'profiles'
           UNION ALL SELECT 'auditoria' ORDER BY 1 LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
      FROM pg_attribute a
     WHERE a.attrelid = ('public.' || quote_ident(r.tabla))::regclass AND a.attnum > 0
       AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = '';

    v := pg_temp.como('vi', format('UPDATE public.%I SET %s = %s', r.tabla,
           split_part(v_cols, ', ', 1), split_part(v_cols, ', ', 1)));
    IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || (r.tabla || ' UPDATE: ' || v); END IF;

    v := pg_temp.como('vi', format('DELETE FROM public.%I', r.tabla));
    IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || (r.tabla || ' DELETE: ' || v); END IF;

    v := pg_temp.como('vi', format('INSERT INTO public.%I (%s) SELECT %s FROM public.%I LIMIT 1',
           r.tabla, v_cols, v_cols, r.tabla));
    IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || (r.tabla || ' INSERT: ' || v); END IF;
  END LOOP;

  v := pg_temp.como('vi', format('UPDATE public.profiles SET full_name = full_name WHERE id <> %L', current_setting('d2.vi')));
  IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || ('profiles de otros UPDATE: ' || v); END IF;
  v := pg_temp.como('vi', 'DELETE FROM public.profiles');
  IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || ('profiles DELETE: ' || v); END IF;

  v := pg_temp.como('vi', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('facturas', 'textil/d2-visor.pdf')$q$);
  IF v NOT LIKE 'error%' THEN f := f || ('sube un PDF textil: ' || v); END IF;
  v := pg_temp.como('vi', $q$DELETE FROM storage.objects WHERE bucket_id = 'facturas'$q$);
  IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || ('borra PDF: ' || v); END IF;

  PERFORM pg_temp.informar(format('4a. el visor no crea, no cambia ni borra nada en ninguna de las %s tablas ni en storage (de profiles, solo su propio nombre)',
    (SELECT count(*) + 1 FROM d2_tablas)), f);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; v TEXT;
BEGIN
  -- El editor sin tiendas: ahora modifica en cualquiera (es lo que dice su
  -- nivel), pero sigue sin borrar entidades ni gestionar accesos.
  IF EXISTS (SELECT 1 FROM public.clientes) THEN
    v := pg_temp.como('ed', 'UPDATE public.clientes SET nombre = nombre');
    IF v = '0' OR v LIKE 'error%' THEN f := f || ('no modifica clientes: ' || v); END IF;
    v := pg_temp.como('ed', 'DELETE FROM public.clientes');
    IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || ('borra clientes: ' || v); END IF;
  ELSE
    f := f || 'no hay clientes: la prueba no demuestra nada'::TEXT;
  END IF;
  v := pg_temp.como('ed', format($q$INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES (%L, %L)$q$,
         current_setting('d2.tienda'), current_setting('d2.ed')));
  IF v NOT LIKE 'error%' THEN f := f || ('se da acceso a una tienda: ' || v); END IF;
  PERFORM pg_temp.informar('4b. el editor sin tiendas modifica en todas, pero no borra ni se da accesos', f);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Desactivado y sin nivel
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}'; r RECORD; v TEXT;
BEGIN
  FOR r IN SELECT tabla FROM d2_tablas
            WHERE tabla NOT IN ('empresas', 'user_roles', 'tienda_usuarios', 'profiles')
            ORDER BY tabla LOOP
    v := pg_temp.como('off', format('SELECT count(*) FROM public.%I', r.tabla));
    IF v <> '0' AND v NOT LIKE 'error%' THEN f := f || (r.tabla || ': ' || v); END IF;
  END LOOP;
  IF pg_temp.como('off', 'SELECT count(*) FROM public.auditoria') <> '0' THEN
    f := f || 'auditoria'::TEXT;
  END IF;
  -- De user_roles, tienda_usuarios y profiles, solo lo suyo.
  IF pg_temp.como('off', 'SELECT count(*) FROM public.user_roles') <> '1' THEN
    f := f || ('user_roles: ' || pg_temp.como('off', 'SELECT count(*) FROM public.user_roles'));
  END IF;
  IF pg_temp.como('off', 'SELECT count(*) FROM public.tienda_usuarios') <> '1' THEN
    f := f || ('tienda_usuarios: ' || pg_temp.como('off', 'SELECT count(*) FROM public.tienda_usuarios'));
  END IF;
  PERFORM pg_temp.informar('5a. el desactivado no ve nada (aunque tenga tienda); de los usuarios, solo lo suyo', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}'; v TEXT;
BEGIN
  v := pg_temp.como('sin', 'SELECT count(*) FROM public.tiendas');
  IF v <> '1' THEN f := f || ('ve ' || v || ' tiendas'); END IF;
  v := pg_temp.como('sin', 'SELECT count(*) FROM public.pedidos');
  IF v <> (SELECT count(*) FROM public.pedidos WHERE tienda_id = current_setting('d2.tienda')::UUID)::TEXT THEN
    f := f || ('ve ' || v || ' pedidos');
  END IF;
  v := pg_temp.como('sin', 'SELECT count(*) FROM public.user_roles');
  IF v <> '0' THEN f := f || ('ve ' || v || ' niveles'); END IF;
  v := pg_temp.como('sin', 'SELECT count(*) FROM public.auditoria');
  IF v <> '0' THEN f := f || ('ve ' || v || ' filas de auditoría'); END IF;
  v := pg_temp.como('sin', 'UPDATE public.pedidos SET numero = numero');
  IF v NOT IN ('0') AND v NOT LIKE 'error%' THEN f := f || ('modifica pedidos: ' || v); END IF;
  PERFORM pg_temp.informar('5b. quien no tiene nivel (alta a medias) solo ve lo de su tienda, como antes, y no escribe', f);
END $$;

-- ---------------------------------------------------------------------------
-- 6. La reversión y otra vez la migración
-- ---------------------------------------------------------------------------
SET client_min_messages = warning;
\ir ../reversiones/20261031400000_niveles_lectura_total.sql
RESET client_min_messages;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('rol_puede_ver', 'rol_ve_empresa')) THEN
    f := f || 'quedan las funciones nuevas'::TEXT;
  END IF;
  IF pg_temp.como('vi', 'SELECT count(*) FROM public.tiendas') <> '0' THEN
    f := f || 'el visor sin tiendas sigue viendo tiendas'::TEXT;
  END IF;
  IF pg_temp.como('vi', 'SELECT count(*) FROM public.auditoria') <> '0' THEN
    f := f || 'el visor sigue viendo la auditoría'::TEXT;
  END IF;
  IF pg_temp.como('adm', 'SELECT count(*) FROM public.auditoria') <> (SELECT count(*) FROM public.auditoria)::TEXT THEN
    f := f || 'el admin ya no ve la auditoría'::TEXT;
  END IF;
  PERFORM pg_temp.informar('6a. tras la reversión, el visor vuelve a ver solo lo de sus tiendas', f);
END $$;

SET client_min_messages = warning;
\ir ../migrations/20261031400000_niveles_lectura_total.sql
RESET client_min_messages;

DO $$
DECLARE f TEXT[] := '{}'; v_adm TEXT; v_vi TEXT;
BEGIN
  v_adm := pg_temp.como('adm', 'SELECT count(*) FROM public.pedidos');
  v_vi  := pg_temp.como('vi', 'SELECT count(*) FROM public.pedidos');
  IF v_vi <> v_adm THEN f := f || ('pedidos: visor ' || v_vi || ', admin ' || v_adm); END IF;
  PERFORM pg_temp.informar('6b. y se puede volver a aplicar', f);
END $$;

ROLLBACK;
