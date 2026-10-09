-- ============================================================================
-- Políticas por operación: el mismo acceso que daban los FOR ALL
-- ============================================================================
-- Prueba 20261023100000_politicas_por_operacion.sql.
--
-- Todo va dentro de una transacción que se deshace al final: la prueba crea
-- una segunda empresa, usuarios y documentos que no deben quedarse para las
-- demás pruebas (con dos empresas activas empresa_por_defecto() falla; la de
-- aquí se crea inactiva, pero ni así se deja).
BEGIN;

-- Permisos que Supabase concede por defecto sobre public y el shim no (igual
-- que en 20_auditoria_autor.sql). Así lo que decide en cada caso es la RLS.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ---------------------------------------------------------------------------
-- 0. La base como estaba: los doce FOR ALL, con su nombre y su condición
--    originales (copiados de las migraciones que los crearon). Después se
--    aplica la migración dos veces: tiene que quitarlos y poder repetirse.
-- ---------------------------------------------------------------------------
CREATE POLICY "pedidos member access" ON public.pedidos FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));
CREATE POLICY "pedido_items member access" ON public.pedido_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));
CREATE POLICY "tienda_usuarios admin write" ON public.tienda_usuarios FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "no direct access creds" ON public.tienda_credenciales FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "seguimiento_member_access" ON public.tienda_seguimiento_config
  FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));
CREATE POLICY "Members manage seguimiento de su tienda"
  ON public.enlaces_seguimiento
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = enlaces_seguimiento.pedido_id
        AND public.is_tienda_member(auth.uid(), p.tienda_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = enlaces_seguimiento.pedido_id
        AND public.is_tienda_member(auth.uid(), p.tienda_id)
    )
  );
CREATE POLICY "miembros_tienda_devoluciones"
  ON public.pedido_devoluciones
  FOR ALL
  TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));
CREATE POLICY "empresa_global admin write" ON public.empresa_global
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cliente_tiendas por pertenencia" ON public.cliente_tiendas
  FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));
-- Las tres de líneas textil, tal como las genera 20260902120200.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('textil_presupuesto_items', 'presupuesto_id', 'textil_presupuestos'),
      ('textil_pedido_items',      'pedido_id',      'textil_pedidos'),
      ('textil_factura_items',     'factura_id',     'textil_facturas')
    ) AS t(tabla, columna, padre)
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I '
      '               AND public.es_miembro_empresa(auth.uid(), p.empresa_id))) '
      'WITH CHECK (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I '
      '               AND public.es_miembro_empresa(auth.uid(), p.empresa_id)))',
      r.tabla || '_por_documento', r.tabla,
      r.padre, r.tabla, r.columna,
      r.padre, r.tabla, r.columna);
  END LOOP;
END $$;

-- Lo que decían, para compararlo con lo que queda.
CREATE TEMP TABLE c11_viejas ON COMMIT DROP AS
  SELECT tablename::TEXT AS tabla, policyname::TEXT AS nombre, qual, with_check
    FROM pg_policies
   WHERE schemaname = 'public' AND cmd = 'ALL';

SELECT CASE WHEN (SELECT count(*) FROM c11_viejas) = 12
            THEN 'BIEN  0. la base de partida tiene los doce FOR ALL'
            ELSE 'MAL   0. la base de partida tiene ' || (SELECT count(*) FROM c11_viejas) || ' FOR ALL, no doce' END;

SET client_min_messages = warning;
\ir ../migrations/20261023100000_politicas_por_operacion.sql
\ir ../migrations/20261023100000_politicas_por_operacion.sql
RESET client_min_messages;

-- ---------------------------------------------------------------------------
-- 1-4. La forma: ningún FOR ALL y la misma condición en cada operación
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND cmd = 'ALL')
            THEN 'BIEN  1. no queda ninguna política FOR ALL en public'
            ELSE 'MAL   1. quedan FOR ALL: '
                 || (SELECT string_agg(tablename || ' «' || policyname || '»', ', ')
                       FROM pg_policies WHERE schemaname = 'public' AND cmd = 'ALL') END;

-- Para cada FOR ALL viejo (menos los dos que la migración trata aparte): una
-- lectura con su USING, un alta con su WITH CHECK, una edición con los dos y
-- un borrado con su USING. Todas permisivas y para authenticated.
CREATE OR REPLACE FUNCTION pg_temp.hay(_tabla TEXT, _cmd TEXT, _qual TEXT, _check TEXT)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = _tabla AND p.cmd = _cmd
       AND p.permissive = 'PERMISSIVE' AND p.roles = '{authenticated}'::name[]
       AND p.qual IS NOT DISTINCT FROM _qual
       AND p.with_check IS NOT DISTINCT FROM _check)
$$;

SELECT CASE WHEN fallan IS NULL
            THEN 'BIEN  2. diez tablas: lectura, alta, edición y borrado con la condición exacta del FOR ALL'
            ELSE 'MAL   2. no cuadra la condición en: ' || fallan END
  FROM (
    SELECT string_agg(v.tabla, ', ' ORDER BY v.tabla) AS fallan
      FROM c11_viejas v
     WHERE v.tabla NOT IN ('textil_factura_items', 'tienda_credenciales')
       AND NOT (pg_temp.hay(v.tabla, 'SELECT', v.qual, NULL)
            AND pg_temp.hay(v.tabla, 'INSERT', NULL, v.with_check)
            AND pg_temp.hay(v.tabla, 'UPDATE', v.qual, v.with_check)
            AND pg_temp.hay(v.tabla, 'DELETE', v.qual, NULL))
  ) x;

SELECT CASE WHEN pg_temp.hay('textil_factura_items', 'SELECT',
                   (SELECT qual FROM c11_viejas WHERE tabla = 'textil_factura_items'), NULL)
             AND NOT EXISTS (SELECT 1 FROM pg_policies
                              WHERE schemaname = 'public' AND tablename = 'textil_factura_items'
                                AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
            THEN 'BIEN  3. textil_factura_items: solo lectura, con la condición de antes'
            ELSE 'MAL   3. textil_factura_items no se ha quedado en solo lectura' END;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies
                              WHERE schemaname = 'public' AND tablename = 'tienda_credenciales')
             AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tienda_credenciales'::regclass)
            THEN 'BIEN  4. tienda_credenciales: RLS activa y ninguna política que dé acceso'
            ELSE 'MAL   4. tienda_credenciales tiene políticas o no tiene RLS' END;

-- ---------------------------------------------------------------------------
-- Datos: dos tiendas de la empresa, una tienda de otra empresa y cuatro
-- usuarios. UA es de la tienda A; UB, de la B; UC, de la tienda C de otra
-- empresa; ADM es administrador y no es de ninguna tienda.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c1100000-0000-4000-8000-00000000000a', 'ua@c11.test'),
  ('c1100000-0000-4000-8000-00000000000b', 'ub@c11.test'),
  ('c1100000-0000-4000-8000-00000000000c', 'uc@c11.test'),
  ('c1100000-0000-4000-8000-00000000000d', 'adm@c11.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c1100000-0000-4000-8000-00000000000d', 'admin');

SELECT set_config('c11.ua',  'c1100000-0000-4000-8000-00000000000a', true),
       set_config('c11.ub',  'c1100000-0000-4000-8000-00000000000b', true),
       set_config('c11.uc',  'c1100000-0000-4000-8000-00000000000c', true),
       set_config('c11.adm', 'c1100000-0000-4000-8000-00000000000d', true);

DO $$
DECLARE
  v_e2 UUID;
  v_a UUID; v_b UUID; v_c UUID;
  v_pa UUID; v_pb UUID;
  v_k UUID; v_k2 UUID;
  v_tp UUID; v_tpe UUID; v_tf UUID;
BEGIN
  INSERT INTO public.empresas (razon_social, activa) VALUES ('Otra empresa C11', false) RETURNING id INTO v_e2;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C11 A', 'tienda-c11-a') RETURNING id INTO v_a;
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C11 B', 'tienda-c11-b') RETURNING id INTO v_b;
  INSERT INTO public.tiendas (nombre, slug, empresa_id) VALUES ('Tienda C11 C', 'tienda-c11-c', v_e2) RETURNING id INTO v_c;

  INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES
    (v_a, current_setting('c11.ua')::UUID),
    (v_b, current_setting('c11.ub')::UUID),
    (v_c, current_setting('c11.uc')::UUID);

  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_a, 'C11-A') RETURNING id INTO v_pa;
  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_b, 'C11-B') RETURNING id INTO v_pb;
  INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES (v_pa, 'C11 línea A'), (v_pb, 'C11 línea B');
  INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, importe) VALUES (v_pa, v_a, 1), (v_pb, v_b, 1);
  INSERT INTO public.enlaces_seguimiento (pedido_id, codigo_seguimiento) VALUES (v_pa, 'C11-SEG-A'), (v_pb, 'C11-SEG-B');
  INSERT INTO public.tienda_seguimiento_config (tienda_id, transportista) VALUES (v_a, 'C11 A'), (v_b, 'C11 B');

  INSERT INTO public.clientes (nombre) VALUES ('Cliente C11') RETURNING id INTO v_k;
  INSERT INTO public.clientes (nombre) VALUES ('Cliente C11 bis') RETURNING id INTO v_k2;
  INSERT INTO public.cliente_tiendas (cliente_id, tienda_id) VALUES (v_k, v_a), (v_k, v_b);

  INSERT INTO public.textil_presupuestos (numero) VALUES ('C11-PRES') RETURNING id INTO v_tp;
  INSERT INTO public.textil_presupuesto_items (presupuesto_id, descripcion) VALUES (v_tp, 'C11 línea presupuesto');
  INSERT INTO public.textil_pedidos (numero) VALUES ('C11-PED') RETURNING id INTO v_tpe;
  INSERT INTO public.textil_pedido_items (pedido_id, descripcion) VALUES (v_tpe, 'C11 línea pedido');
  INSERT INTO public.textil_facturas (numero, estado) VALUES ('C11-FAC', 'borrador') RETURNING id INTO v_tf;
  INSERT INTO public.textil_factura_items (factura_id, descripcion) VALUES (v_tf, 'C11 línea factura');

  PERFORM set_config('c11.e2', v_e2::TEXT, true);
  PERFORM set_config('c11.a', v_a::TEXT, true);
  PERFORM set_config('c11.b', v_b::TEXT, true);
  PERFORM set_config('c11.pa', v_pa::TEXT, true);
  PERFORM set_config('c11.pb', v_pb::TEXT, true);
  PERFORM set_config('c11.k', v_k::TEXT, true);
  PERFORM set_config('c11.k2', v_k2::TEXT, true);
  PERFORM set_config('c11.tp', v_tp::TEXT, true);
  PERFORM set_config('c11.tpe', v_tpe::TEXT, true);
  PERFORM set_config('c11.tf', v_tf::TEXT, true);
END $$;

-- Ejecuta una sentencia como el usuario _quien, con el rol authenticated y su
-- JWT, como llega desde el navegador. Devuelve el número de filas (lo que
-- cuenta un SELECT count(*), o las afectadas por un INSERT, UPDATE o DELETE),
-- o «error» y el SQLSTATE. Si falla, el bloque se deshace entero y el rol y el
-- JWT vuelven a ser los de antes.
CREATE OR REPLACE FUNCTION pg_temp.como(_quien TEXT, _sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('c11.' || _quien), true);
  SET LOCAL ROLE authenticated;
  IF _sql ~* '^\s*select' THEN
    EXECUTE _sql INTO v_n;
  ELSE
    EXECUTE _sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_n::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE;
END $$;

-- Un caso: NULL si sale lo esperado; si no, qué ha fallado.
CREATE OR REPLACE FUNCTION pg_temp.caso(_que TEXT, _quien TEXT, _sql TEXT, _esperado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT := pg_temp.como(_quien, _sql);
BEGIN
  IF v = _esperado THEN RETURN NULL; END IF;
  RETURN _que || ' (esperaba ' || _esperado || ', salió ' || v || ')';
END $$;

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

-- 42501 es «insufficient_privilege»: lo que devuelve Postgres cuando la RLS
-- rechaza una fila nueva (WITH CHECK) o falta el permiso sobre la tabla.

-- ---------------------------------------------------------------------------
-- 5. pedidos
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee lo suyo', 'ua', $q$SELECT count(*) FROM public.pedidos WHERE id = current_setting('c11.pa')::uuid$q$, '1');
  f := f || pg_temp.caso('ve lo de B', 'ua', $q$SELECT count(*) FROM public.pedidos WHERE id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('edita lo suyo', 'ua', $q$UPDATE public.pedidos SET notas = 'C11' WHERE id = current_setting('c11.pa')::uuid$q$, '1');
  f := f || pg_temp.caso('edita lo de B', 'ua', $q$UPDATE public.pedidos SET notas = 'C11' WHERE id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('pasa lo suyo a B', 'ua', $q$UPDATE public.pedidos SET tienda_id = current_setting('c11.b')::uuid WHERE id = current_setting('c11.pa')::uuid$q$, 'error 42501');
  f := f || pg_temp.caso('da de alta en A', 'ua', $q$INSERT INTO public.pedidos (tienda_id, numero) VALUES (current_setting('c11.a')::uuid, 'C11-A2')$q$, '1');
  f := f || pg_temp.caso('da de alta en B', 'ua', $q$INSERT INTO public.pedidos (tienda_id, numero) VALUES (current_setting('c11.b')::uuid, 'C11-B2')$q$, 'error 42501');
  f := f || pg_temp.caso('borra lo suyo', 'ua', $q$DELETE FROM public.pedidos WHERE numero = 'C11-A2'$q$, '1');
  f := f || pg_temp.caso('borra lo de B', 'ua', $q$DELETE FROM public.pedidos WHERE id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('B ve lo de A', 'ub', $q$SELECT count(*) FROM public.pedidos WHERE id = current_setting('c11.pa')::uuid$q$, '0');
  PERFORM pg_temp.informar('5. pedidos: el de la tienda A lee, da de alta, edita y borra lo de A; lo de B ni lo ve ni lo toca', f);
END $$;

-- ---------------------------------------------------------------------------
-- 6. pedido_items
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee lo suyo', 'ua', $q$SELECT count(*) FROM public.pedido_items WHERE pedido_id = current_setting('c11.pa')::uuid$q$, '1');
  f := f || pg_temp.caso('ve lo de B', 'ua', $q$SELECT count(*) FROM public.pedido_items WHERE pedido_id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('edita lo suyo', 'ua', $q$UPDATE public.pedido_items SET descripcion = 'C11 editada' WHERE pedido_id = current_setting('c11.pa')::uuid$q$, '1');
  f := f || pg_temp.caso('edita lo de B', 'ua', $q$UPDATE public.pedido_items SET descripcion = 'C11 editada' WHERE pedido_id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('pasa lo suyo a B', 'ua', $q$UPDATE public.pedido_items SET pedido_id = current_setting('c11.pb')::uuid WHERE pedido_id = current_setting('c11.pa')::uuid$q$, 'error 42501');
  f := f || pg_temp.caso('da de alta en A', 'ua', $q$INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES (current_setting('c11.pa')::uuid, 'C11 nueva')$q$, '1');
  f := f || pg_temp.caso('da de alta en B', 'ua', $q$INSERT INTO public.pedido_items (pedido_id, descripcion) VALUES (current_setting('c11.pb')::uuid, 'C11 nueva')$q$, 'error 42501');
  f := f || pg_temp.caso('borra lo suyo', 'ua', $q$DELETE FROM public.pedido_items WHERE descripcion = 'C11 nueva'$q$, '1');
  f := f || pg_temp.caso('borra lo de B', 'ua', $q$DELETE FROM public.pedido_items WHERE pedido_id = current_setting('c11.pb')::uuid$q$, '0');
  PERFORM pg_temp.informar('6. pedido_items: igual, por la tienda del pedido', f);
END $$;

-- ---------------------------------------------------------------------------
-- 7. pedido_devoluciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee lo suyo', 'ua', $q$SELECT count(*) FROM public.pedido_devoluciones WHERE tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('ve lo de B', 'ua', $q$SELECT count(*) FROM public.pedido_devoluciones WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('edita lo suyo', 'ua', $q$UPDATE public.pedido_devoluciones SET motivo = 'C11' WHERE tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('edita lo de B', 'ua', $q$UPDATE public.pedido_devoluciones SET motivo = 'C11' WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('pasa lo suyo a B', 'ua', $q$UPDATE public.pedido_devoluciones SET tienda_id = current_setting('c11.b')::uuid WHERE tienda_id = current_setting('c11.a')::uuid$q$, 'error 42501');
  f := f || pg_temp.caso('da de alta en A', 'ua', $q$INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, importe, motivo) VALUES (current_setting('c11.pa')::uuid, current_setting('c11.a')::uuid, 2, 'C11 nueva')$q$, '1');
  f := f || pg_temp.caso('da de alta en B', 'ua', $q$INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, importe, motivo) VALUES (current_setting('c11.pb')::uuid, current_setting('c11.b')::uuid, 2, 'C11 nueva')$q$, 'error 42501');
  f := f || pg_temp.caso('borra lo suyo', 'ua', $q$DELETE FROM public.pedido_devoluciones WHERE motivo = 'C11 nueva'$q$, '1');
  f := f || pg_temp.caso('borra lo de B', 'ua', $q$DELETE FROM public.pedido_devoluciones WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  PERFORM pg_temp.informar('7. pedido_devoluciones: igual, por tienda', f);
END $$;

-- ---------------------------------------------------------------------------
-- 8. enlaces_seguimiento
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee lo suyo', 'ua', $q$SELECT count(*) FROM public.enlaces_seguimiento WHERE pedido_id = current_setting('c11.pa')::uuid$q$, '1');
  f := f || pg_temp.caso('ve lo de B', 'ua', $q$SELECT count(*) FROM public.enlaces_seguimiento WHERE pedido_id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('edita lo suyo', 'ua', $q$UPDATE public.enlaces_seguimiento SET estado = 'C11' WHERE pedido_id = current_setting('c11.pa')::uuid$q$, '1');
  f := f || pg_temp.caso('edita lo de B', 'ua', $q$UPDATE public.enlaces_seguimiento SET estado = 'C11' WHERE pedido_id = current_setting('c11.pb')::uuid$q$, '0');
  f := f || pg_temp.caso('pasa lo suyo a B', 'ua', $q$UPDATE public.enlaces_seguimiento SET pedido_id = current_setting('c11.pb')::uuid WHERE pedido_id = current_setting('c11.pa')::uuid$q$, 'error 42501');
  f := f || pg_temp.caso('da de alta en A', 'ua', $q$INSERT INTO public.enlaces_seguimiento (pedido_id, codigo_seguimiento) VALUES (current_setting('c11.pa')::uuid, 'C11 nuevo')$q$, '1');
  f := f || pg_temp.caso('da de alta en B', 'ua', $q$INSERT INTO public.enlaces_seguimiento (pedido_id, codigo_seguimiento) VALUES (current_setting('c11.pb')::uuid, 'C11 nuevo')$q$, 'error 42501');
  f := f || pg_temp.caso('borra lo suyo', 'ua', $q$DELETE FROM public.enlaces_seguimiento WHERE codigo_seguimiento = 'C11 nuevo'$q$, '1');
  f := f || pg_temp.caso('borra lo de B', 'ua', $q$DELETE FROM public.enlaces_seguimiento WHERE pedido_id = current_setting('c11.pb')::uuid$q$, '0');
  PERFORM pg_temp.informar('8. enlaces_seguimiento: igual, por la tienda del pedido', f);
END $$;

-- ---------------------------------------------------------------------------
-- 9. tienda_seguimiento_config (una fila por tienda)
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee lo suyo', 'ua', $q$SELECT count(*) FROM public.tienda_seguimiento_config WHERE tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('ve lo de B', 'ua', $q$SELECT count(*) FROM public.tienda_seguimiento_config WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('edita lo suyo', 'ua', $q$UPDATE public.tienda_seguimiento_config SET codigo_cuenta = 'C11' WHERE tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('edita lo de B', 'ua', $q$UPDATE public.tienda_seguimiento_config SET codigo_cuenta = 'C11' WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('borra lo suyo', 'ua', $q$DELETE FROM public.tienda_seguimiento_config WHERE tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('borra lo de B', 'ua', $q$DELETE FROM public.tienda_seguimiento_config WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('da de alta en A', 'ua', $q$INSERT INTO public.tienda_seguimiento_config (tienda_id, transportista) VALUES (current_setting('c11.a')::uuid, 'C11 otra vez')$q$, '1');
  f := f || pg_temp.caso('da de alta en B', 'ua', $q$INSERT INTO public.tienda_seguimiento_config (tienda_id, transportista) VALUES (current_setting('c11.b')::uuid, 'C11 otra vez')$q$, 'error 42501');
  PERFORM pg_temp.informar('9. tienda_seguimiento_config: igual, por tienda', f);
END $$;

-- ---------------------------------------------------------------------------
-- 10. cliente_tiendas
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee lo suyo', 'ua', $q$SELECT count(*) FROM public.cliente_tiendas WHERE cliente_id = current_setting('c11.k')::uuid AND tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('ve lo de B', 'ua', $q$SELECT count(*) FROM public.cliente_tiendas WHERE cliente_id = current_setting('c11.k')::uuid AND tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('edita lo suyo', 'ua', $q$UPDATE public.cliente_tiendas SET woo_customer_id = 1101 WHERE cliente_id = current_setting('c11.k')::uuid AND tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('edita lo de B', 'ua', $q$UPDATE public.cliente_tiendas SET woo_customer_id = 1102 WHERE cliente_id = current_setting('c11.k')::uuid AND tienda_id = current_setting('c11.b')::uuid$q$, '0');
  f := f || pg_temp.caso('da de alta en A', 'ua', $q$INSERT INTO public.cliente_tiendas (cliente_id, tienda_id) VALUES (current_setting('c11.k2')::uuid, current_setting('c11.a')::uuid)$q$, '1');
  f := f || pg_temp.caso('da de alta en B', 'ua', $q$INSERT INTO public.cliente_tiendas (cliente_id, tienda_id) VALUES (current_setting('c11.k2')::uuid, current_setting('c11.b')::uuid)$q$, 'error 42501');
  f := f || pg_temp.caso('pasa lo suyo a B', 'ua', $q$UPDATE public.cliente_tiendas SET tienda_id = current_setting('c11.b')::uuid WHERE cliente_id = current_setting('c11.k2')::uuid$q$, 'error 42501');
  f := f || pg_temp.caso('borra lo suyo', 'ua', $q$DELETE FROM public.cliente_tiendas WHERE cliente_id = current_setting('c11.k2')::uuid$q$, '1');
  f := f || pg_temp.caso('borra lo de B', 'ua', $q$DELETE FROM public.cliente_tiendas WHERE tienda_id = current_setting('c11.b')::uuid$q$, '0');
  PERFORM pg_temp.informar('10. cliente_tiendas: igual, por tienda', f);
END $$;

-- ---------------------------------------------------------------------------
-- 11-12. Líneas de presupuesto y de pedido textil: por empresa
-- ---------------------------------------------------------------------------
-- Aquí el alcance es la empresa, no la tienda: el de otra tienda de la MISMA
-- empresa sí las ve (y así era). El que no las ve es UC, de otra empresa.
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee las de su empresa', 'ua', $q$SELECT count(*) FROM public.textil_presupuesto_items WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '1');
  f := f || pg_temp.caso('B, de la misma empresa, las lee', 'ub', $q$SELECT count(*) FROM public.textil_presupuesto_items WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '1');
  f := f || pg_temp.caso('otra empresa las ve', 'uc', $q$SELECT count(*) FROM public.textil_presupuesto_items WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '0');
  f := f || pg_temp.caso('edita', 'ua', $q$UPDATE public.textil_presupuesto_items SET descripcion = 'C11 editada' WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '1');
  f := f || pg_temp.caso('otra empresa edita', 'uc', $q$UPDATE public.textil_presupuesto_items SET descripcion = 'C11 ajena' WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '0');
  f := f || pg_temp.caso('da de alta', 'ua', $q$INSERT INTO public.textil_presupuesto_items (presupuesto_id, descripcion) VALUES (current_setting('c11.tp')::uuid, 'C11 nueva')$q$, '1');
  f := f || pg_temp.caso('otra empresa da de alta', 'uc', $q$INSERT INTO public.textil_presupuesto_items (presupuesto_id, descripcion) VALUES (current_setting('c11.tp')::uuid, 'C11 ajena')$q$, 'error 42501');
  f := f || pg_temp.caso('otra empresa borra', 'uc', $q$DELETE FROM public.textil_presupuesto_items WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '0');
  f := f || pg_temp.caso('borra (como al guardar)', 'ua', $q$DELETE FROM public.textil_presupuesto_items WHERE presupuesto_id = current_setting('c11.tp')::uuid$q$, '2');
  PERFORM pg_temp.informar('11. textil_presupuesto_items: la empresa lee, guarda y borra sus líneas; otra empresa no', f);
END $$;

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee las de su empresa', 'ua', $q$SELECT count(*) FROM public.textil_pedido_items WHERE pedido_id = current_setting('c11.tpe')::uuid$q$, '1');
  f := f || pg_temp.caso('otra empresa las ve', 'uc', $q$SELECT count(*) FROM public.textil_pedido_items WHERE pedido_id = current_setting('c11.tpe')::uuid$q$, '0');
  f := f || pg_temp.caso('edita', 'ua', $q$UPDATE public.textil_pedido_items SET descripcion = 'C11 editada' WHERE pedido_id = current_setting('c11.tpe')::uuid$q$, '1');
  f := f || pg_temp.caso('otra empresa edita', 'uc', $q$UPDATE public.textil_pedido_items SET descripcion = 'C11 ajena' WHERE pedido_id = current_setting('c11.tpe')::uuid$q$, '0');
  f := f || pg_temp.caso('da de alta', 'ua', $q$INSERT INTO public.textil_pedido_items (pedido_id, descripcion) VALUES (current_setting('c11.tpe')::uuid, 'C11 nueva')$q$, '1');
  f := f || pg_temp.caso('otra empresa da de alta', 'uc', $q$INSERT INTO public.textil_pedido_items (pedido_id, descripcion) VALUES (current_setting('c11.tpe')::uuid, 'C11 ajena')$q$, 'error 42501');
  f := f || pg_temp.caso('otra empresa borra', 'uc', $q$DELETE FROM public.textil_pedido_items WHERE pedido_id = current_setting('c11.tpe')::uuid$q$, '0');
  f := f || pg_temp.caso('borra (como al guardar)', 'ua', $q$DELETE FROM public.textil_pedido_items WHERE pedido_id = current_setting('c11.tpe')::uuid$q$, '2');
  PERFORM pg_temp.informar('12. textil_pedido_items: igual que las de presupuesto', f);
END $$;

-- ---------------------------------------------------------------------------
-- 13. Líneas de factura textil: se leen, no se escriben
-- ---------------------------------------------------------------------------
-- Aunque authenticated tenga aquí INSERT, UPDATE y DELETE (el GRANT de arriba
-- los devuelve), la RLS ya no deja escribir. En la base real ni siquiera
-- tiene esos permisos desde 20260902130100.
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('lee las de su empresa', 'ua', $q$SELECT count(*) FROM public.textil_factura_items WHERE factura_id = current_setting('c11.tf')::uuid$q$, '1');
  f := f || pg_temp.caso('otra empresa las ve', 'uc', $q$SELECT count(*) FROM public.textil_factura_items WHERE factura_id = current_setting('c11.tf')::uuid$q$, '0');
  f := f || pg_temp.caso('da de alta', 'ua', $q$INSERT INTO public.textil_factura_items (factura_id, descripcion) VALUES (current_setting('c11.tf')::uuid, 'C11 nueva')$q$, 'error 42501');
  f := f || pg_temp.caso('edita', 'ua', $q$UPDATE public.textil_factura_items SET descripcion = 'C11 editada' WHERE factura_id = current_setting('c11.tf')::uuid$q$, '0');
  f := f || pg_temp.caso('borra', 'ua', $q$DELETE FROM public.textil_factura_items WHERE factura_id = current_setting('c11.tf')::uuid$q$, '0');
  f := f || pg_temp.caso('el administrador escribe', 'adm', $q$INSERT INTO public.textil_factura_items (factura_id, descripcion) VALUES (current_setting('c11.tf')::uuid, 'C11 nueva')$q$, 'error 42501');
  PERFORM pg_temp.informar('13. textil_factura_items: su empresa las lee; nadie las escribe desde el navegador', f);
END $$;

-- ---------------------------------------------------------------------------
-- 14. tienda_usuarios: escribe el administrador
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('el admin ve las de A', 'adm', $q$SELECT count(*) FROM public.tienda_usuarios WHERE tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('UA ve la suya', 'ua', $q$SELECT count(*) FROM public.tienda_usuarios WHERE user_id = current_setting('c11.ua')::uuid$q$, '1');
  f := f || pg_temp.caso('UA ve la de UB', 'ua', $q$SELECT count(*) FROM public.tienda_usuarios WHERE user_id = current_setting('c11.ub')::uuid$q$, '0');
  f := f || pg_temp.caso('el admin da de alta', 'adm', $q$INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES (current_setting('c11.a')::uuid, current_setting('c11.ub')::uuid)$q$, '1');
  f := f || pg_temp.caso('UA se da de alta en B', 'ua', $q$INSERT INTO public.tienda_usuarios (tienda_id, user_id) VALUES (current_setting('c11.b')::uuid, current_setting('c11.ua')::uuid)$q$, 'error 42501');
  f := f || pg_temp.caso('el admin edita', 'adm', $q$UPDATE public.tienda_usuarios SET created_at = created_at WHERE user_id = current_setting('c11.ub')::uuid AND tienda_id = current_setting('c11.a')::uuid$q$, '1');
  f := f || pg_temp.caso('UA edita la suya', 'ua', $q$UPDATE public.tienda_usuarios SET tienda_id = current_setting('c11.b')::uuid WHERE user_id = current_setting('c11.ua')::uuid$q$, '0');
  f := f || pg_temp.caso('UA borra la suya', 'ua', $q$DELETE FROM public.tienda_usuarios WHERE user_id = current_setting('c11.ua')::uuid$q$, '0');
  f := f || pg_temp.caso('el admin borra', 'adm', $q$DELETE FROM public.tienda_usuarios WHERE user_id = current_setting('c11.ub')::uuid AND tienda_id = current_setting('c11.a')::uuid$q$, '1');
  PERFORM pg_temp.informar('14. tienda_usuarios: cada uno lee la suya; dar, cambiar y quitar acceso, solo el administrador', f);
END $$;

-- ---------------------------------------------------------------------------
-- 15. empresa_global (obsoleta): escribe el administrador
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('el admin la lee', 'adm', $q$SELECT count(*) FROM public.empresa_global$q$, '1');
  f := f || pg_temp.caso('UA la lee', 'ua', $q$SELECT count(*) FROM public.empresa_global$q$, '1');
  f := f || pg_temp.caso('UA la edita', 'ua', $q$UPDATE public.empresa_global SET telefono = 'C11'$q$, '0');
  f := f || pg_temp.caso('UA la borra', 'ua', $q$DELETE FROM public.empresa_global$q$, '0');
  f := f || pg_temp.caso('el admin la edita', 'adm', $q$UPDATE public.empresa_global SET telefono = telefono$q$, '1');
  f := f || pg_temp.caso('el admin la borra', 'adm', $q$DELETE FROM public.empresa_global$q$, '1');
  f := f || pg_temp.caso('UA la crea', 'ua', $q$INSERT INTO public.empresa_global (id) VALUES (true)$q$, 'error 42501');
  f := f || pg_temp.caso('el admin la crea', 'adm', $q$INSERT INTO public.empresa_global (id) VALUES (true)$q$, '1');
  PERFORM pg_temp.informar('15. empresa_global: la leen los de siempre; escribir, solo el administrador', f);
END $$;

-- ---------------------------------------------------------------------------
-- 16. tienda_credenciales: nadie desde el navegador, tampoco el administrador
-- ---------------------------------------------------------------------------
INSERT INTO public.tienda_credenciales (tienda_id, consumer_key, consumer_secret)
VALUES (current_setting('c11.a')::uuid, 'ck_c11', 'cs_c11');

DO $$
DECLARE f TEXT[] := '{}';
BEGIN
  f := f || pg_temp.caso('el admin lee', 'adm', $q$SELECT count(*) FROM public.tienda_credenciales$q$, '0');
  f := f || pg_temp.caso('UA lee las de A', 'ua', $q$SELECT count(*) FROM public.tienda_credenciales$q$, '0');
  f := f || pg_temp.caso('el admin edita', 'adm', $q$UPDATE public.tienda_credenciales SET consumer_key = 'otra'$q$, '0');
  f := f || pg_temp.caso('el admin borra', 'adm', $q$DELETE FROM public.tienda_credenciales$q$, '0');
  f := f || pg_temp.caso('el admin da de alta', 'adm', $q$INSERT INTO public.tienda_credenciales (tienda_id, consumer_key, consumer_secret) VALUES (current_setting('c11.b')::uuid, 'x', 'y')$q$, 'error 42501');
  PERFORM pg_temp.informar('16. tienda_credenciales: sigue sin verse ni tocarse desde el navegador', f);
END $$;

ROLLBACK;
