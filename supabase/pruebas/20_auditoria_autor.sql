-- ============================================================================
-- ¿De quién es cada escritura?
-- ============================================================================
-- El registro de auditoría es el único control que hay sobre tres
-- administradores con permisos idénticos. Estas pruebas comprueban las dos
-- mitades de eso: que el autor se registra cuando lo hay, y que no se puede
-- falsificar cuando no lo hay.
-- ============================================================================

-- Permisos que Supabase concede por defecto sobre el esquema public y el shim
-- no. Sin ellos no se puede probar ningún camino que no sea el de superusuario.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'javier@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'otro@ejemplo.es')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
VALUES ('11111111-1111-1111-1111-111111111111', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.ultimo_autor() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT COALESCE(usuario_id::TEXT, 'SIN AUTOR')
  FROM public.auditoria WHERE tabla = 'textil_marcas' ORDER BY id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION pg_temp.comprobar(etiqueta TEXT, esperado TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v TEXT := pg_temp.ultimo_autor();
BEGIN
  IF v = esperado THEN RETURN 'BIEN  ' || etiqueta;
  ELSE RETURN 'MAL   ' || etiqueta || ' (esperaba ' || esperado || ', salió ' || v || ')';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Rol de servicio con cabecera: es el caso de supabaseAdmin
-- ---------------------------------------------------------------------------
BEGIN;
  SET LOCAL ROLE service_role;
  SELECT set_config('request.headers',
    '{"x-usuario-id":"11111111-1111-1111-1111-111111111111"}', true);
  INSERT INTO public.textil_marcas (nombre) VALUES ('caso 1');
COMMIT;
SELECT pg_temp.comprobar('1. supabaseAdmin firma con la cabecera',
  '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 2. Usuario autenticado con una cabecera que dice ser otro
-- ---------------------------------------------------------------------------
-- El JWT tiene que ganar. Si no, cualquiera firma como cualquiera.
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  SELECT set_config('request.headers',
    '{"x-usuario-id":"22222222-2222-2222-2222-222222222222"}', true);
  INSERT INTO public.textil_marcas (nombre) VALUES ('caso 2');
COMMIT;
SELECT pg_temp.comprobar('2. el JWT gana a una cabecera que miente',
  '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 3. app.usuario_id gana a todo
-- ---------------------------------------------------------------------------
-- Lo fija emitir_factura() dentro de su propia transacción.
BEGIN;
  SET LOCAL ROLE service_role;
  SELECT set_config('app.usuario_id',
    '22222222-2222-2222-2222-222222222222', true);
  SELECT set_config('request.headers',
    '{"x-usuario-id":"11111111-1111-1111-1111-111111111111"}', true);
  INSERT INTO public.textil_marcas (nombre) VALUES ('caso 3');
COMMIT;
SELECT pg_temp.comprobar('3. app.usuario_id gana a la cabecera',
  '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------------
-- 4. Una cabecera sin rol de servicio no vale nada
-- ---------------------------------------------------------------------------
BEGIN;
  SET LOCAL ROLE service_role;   -- solo para poder llegar a escribir
  SELECT set_config('request.headers',
    '{"x-usuario-id":"11111111-1111-1111-1111-111111111111"}', true);
  RESET ROLE;                    -- ...pero se escribe ya sin ese rol
  INSERT INTO public.textil_marcas (nombre) VALUES ('caso 4');
COMMIT;
SELECT pg_temp.comprobar('4. cabecera sin rol de servicio, sin autor',
  'SIN AUTOR');

-- ---------------------------------------------------------------------------
-- 5. Basura en la cabecera no tumba la escritura
-- ---------------------------------------------------------------------------
BEGIN;
  SET LOCAL ROLE service_role;
  SELECT set_config('request.headers', 'esto no es json', true);
  INSERT INTO public.textil_marcas (nombre) VALUES ('caso 5');
COMMIT;
SELECT pg_temp.comprobar('5. cabecera con basura, sin autor', 'SIN AUTOR');

-- ---------------------------------------------------------------------------
-- 6. Sin identificarse no se escribe
-- ---------------------------------------------------------------------------
-- Este es el que sostiene todo lo demás: aunque alguien pudiera colar una
-- cabecera, para dejar un registro falso hay que conseguir escribir, y la RLS
-- no se lo permite ni a anon ni a un authenticated sin JWT.
DO $$
DECLARE v_antes BIGINT; v_despues BIGINT;
BEGIN
  SELECT count(*) INTO v_antes FROM public.textil_marcas;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.headers',
      '{"x-usuario-id":"11111111-1111-1111-1111-111111111111"}', true);
    EXECUTE $q$INSERT INTO public.textil_marcas (nombre) VALUES ('intento anon')$q$;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_despues FROM public.textil_marcas;
  IF v_despues = v_antes THEN
    RAISE NOTICE 'BIEN  6. anon no puede escribir, así que no puede falsificar';
  ELSE
    RAISE NOTICE 'MAL   6. anon ha conseguido escribir';
  END IF;
END $$;

DO $$
DECLARE v_antes BIGINT; v_despues BIGINT;
BEGIN
  SELECT count(*) INTO v_antes FROM public.textil_marcas;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.headers',
      '{"x-usuario-id":"11111111-1111-1111-1111-111111111111"}', true);
    EXECUTE $q$INSERT INTO public.textil_marcas (nombre) VALUES ('intento sin jwt')$q$;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_despues FROM public.textil_marcas;
  IF v_despues = v_antes THEN
    RAISE NOTICE 'BIEN  7. authenticated sin JWT tampoco escribe';
  ELSE
    RAISE NOTICE 'MAL   7. se ha escrito sin identificarse';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. La cadena sigue intacta después de todo esto
-- ---------------------------------------------------------------------------
SELECT CASE WHEN count(*) = 0 THEN 'BIEN  8. la cadena de auditoría sigue intacta'
            ELSE 'MAL   8. la cadena está rota' END
FROM public.auditoria_verificar();
