-- ============================================================================
-- Rate limiting en el login: bloqueo temporal tras varios fallos seguidos
-- ============================================================================
--
-- QUÉ HACE
--   Da de alta el Auth Hook "Password Verification Attempt" de Supabase:
--   una función de Postgres a la que Supabase Auth llama en cada intento de
--   inicio de sesión con contraseña, antes de decidir si lo deja pasar.
--
--   Por cuenta (no por IP, el hook no ve la IP): a partir del 5º fallo
--   seguido en 15 minutos, bloquea esa cuenta 15 minutos más, aunque a partir
--   de ahí escriban la contraseña correcta. Un login correcto borra el
--   contador. El bloqueo se cuenta por usuario ya identificado por su email,
--   así que no sirve para adivinar si un email existe o no: eso ya lo decide
--   Supabase Auth antes de llegar aquí, sin cambios de esta migración.
--
-- POR QUÉ
--   El login (src/routes/auth.tsx) llama a
--   supabase.auth.signInWithPassword() directo desde el navegador: no pasa
--   por ninguna server function nuestra, así que no hay sitio en el código de
--   la aplicación donde contar intentos. Los Auth Hooks son el mecanismo que
--   ofrece Supabase para engancharse ahí sin escribir un proxy ni una Edge
--   Function — y no se van a añadir Edge Functions a este proyecto (ver
--   CLAUDE.md).
--
-- ESTO NO ES SUFICIENTE POR SÍ SOLO
--   Supabase Auth ya trae un límite por IP a nivel de plataforma (Dashboard →
--   Authentication → Rate Limits, "Sign in with password"), independiente de
--   esta migración. Esta migración añade el bloqueo POR CUENTA que faltaba:
--   sin ella, alguien con muchas IPs distintas puede probar contraseñas
--   contra un email conocido sin que nada lo frene.
--
-- HACE FALTA UN PASO A MANO, ADEMÁS DE APLICAR ESTE SQL
--   Crear la función no activa el hook. En el Dashboard de Supabase:
--   Authentication → Hooks → "Password Verification Attempt" → Enable hook,
--   tipo Postgres, función public.hook_password_verification_attempt.
--   Sin ese paso, esta migración no hace nada.
--
-- LOS NÚMEROS SON AJUSTABLES
--   v_max_intentos (5), v_ventana (15 min) y v_bloqueo (15 min) están como
--   constantes al principio de la función. Cambiarlos es un CREATE OR REPLACE
--   FUNCTION nuevo, no hace falta otra migración de esquema.
--
-- REVERSIBLE
--   Sí. Desactivar el hook en el Dashboard (o borrar la función) deja el
--   login exactamente como está hoy. DROP TABLE
--   auth_intentos_fallidos_login se lleva el histórico de bloqueos, que no
--   es un dato de negocio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Dónde se cuentan los fallos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_intentos_fallidos_login (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fallos INTEGER NOT NULL DEFAULT 0,
  ultimo_fallo_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  bloqueado_hasta TIMESTAMPTZ
);

COMMENT ON TABLE public.auth_intentos_fallidos_login IS
  'Contador de fallos de contraseña por usuario, para el Auth Hook '
  '"Password Verification Attempt". Solo la lee y la escribe ese hook, con '
  'el rol supabase_auth_admin. No la usa la aplicación.';

-- Sin RLS aquí a propósito, al revés que el resto de tablas del proyecto: lo
-- que de verdad la protege es el REVOKE de abajo, que le quita todo acceso a
-- anon y a authenticated — los únicos roles con los que PostgREST llega a
-- conectarse. supabase_auth_admin no pasa por PostgREST, pasa por dentro de
-- Auth, y activarle RLS sin ninguna política dependería de si ese rol tiene
-- BYPASSRLS — no hay forma de comprobarlo desde aquí sin acceso al proyecto
-- real, y equivocarse rompería el login para todo el mundo el día que se
-- active el hook. El patrón de la documentación oficial de Supabase para
-- este hook tampoco usa RLS, solo GRANT/REVOKE: se sigue tal cual.
REVOKE ALL ON public.auth_intentos_fallidos_login FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.auth_intentos_fallidos_login TO supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 2. El hook
-- ---------------------------------------------------------------------------
-- Contrato fijado por Supabase: recibe {"user_id": "...", "valid": bool} y
-- devuelve {"decision": "continue"} para dejarlo pasar, o
-- {"error": {"http_code": ..., "message": ...}} para rechazarlo con ese
-- mensaje. No es una función SECURITY DEFINER: se ejecuta como
-- supabase_auth_admin, que ya tiene permiso de sobra por el GRANT de arriba.
CREATE OR REPLACE FUNCTION public.hook_password_verification_attempt(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_user_id UUID := (event->>'user_id')::UUID;
  v_valido BOOLEAN := (event->>'valid')::BOOLEAN;
  v_max_intentos CONSTANT INTEGER := 5;
  v_ventana CONSTANT INTERVAL := '15 minutes';
  v_bloqueo CONSTANT INTERVAL := '15 minutes';
  v_fila public.auth_intentos_fallidos_login;
BEGIN
  SELECT * INTO v_fila
    FROM public.auth_intentos_fallidos_login
    WHERE user_id = v_user_id
    FOR UPDATE;

  -- Ya bloqueado: no importa si esta contraseña es correcta o no, se sigue
  -- rechazando hasta que pase el bloqueo. Si no fuera así, probar
  -- contraseñas al azar seguiría revelando —por la diferencia de
  -- respuesta— cuál es la buena, que es justo lo que el bloqueo evita.
  IF v_fila.bloqueado_hasta IS NOT NULL AND v_fila.bloqueado_hasta > now() THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 429,
        'message', format(
          'Demasiados intentos fallidos. Vuelve a intentarlo dentro de %s minutos.',
          ceil(extract(epoch FROM (v_fila.bloqueado_hasta - now())) / 60)
        )
      )
    );
  END IF;

  IF v_valido THEN
    -- Contraseña correcta: se borra el historial de fallos, si lo había.
    DELETE FROM public.auth_intentos_fallidos_login WHERE user_id = v_user_id;
    RETURN jsonb_build_object('decision', 'continue');
  END IF;

  -- Contraseña incorrecta. Sin fila previa, o con la última hace más de la
  -- ventana: empieza a contar de nuevo. Dentro de la ventana: suma uno, y si
  -- llega al máximo, bloquea desde ahora.
  IF v_fila.user_id IS NULL OR now() - v_fila.ultimo_fallo_en > v_ventana THEN
    INSERT INTO public.auth_intentos_fallidos_login (user_id, fallos, ultimo_fallo_en)
      VALUES (v_user_id, 1, now())
      ON CONFLICT (user_id) DO UPDATE
        SET fallos = 1, ultimo_fallo_en = now(), bloqueado_hasta = NULL;
  ELSE
    UPDATE public.auth_intentos_fallidos_login
      SET fallos = fallos + 1,
          ultimo_fallo_en = now(),
          bloqueado_hasta = CASE WHEN fallos + 1 >= v_max_intentos THEN now() + v_bloqueo ELSE NULL END
      WHERE user_id = v_user_id;
  END IF;

  -- Este intento en sí ya era una contraseña incorrecta: Supabase Auth lo
  -- rechaza igualmente por su cuenta. El bloqueo por 429 con mensaje propio
  -- empieza a aplicarse desde el intento siguiente.
  RETURN jsonb_build_object('decision', 'continue');
END;
$$;

COMMENT ON FUNCTION public.hook_password_verification_attempt IS
  'Auth Hook "Password Verification Attempt" de Supabase. Bloquea una cuenta '
  '15 minutos tras 5 fallos de contraseña seguidos en 15 minutos. Hay que '
  'activarlo a mano en el Dashboard: Authentication → Hooks.';

REVOKE ALL ON FUNCTION public.hook_password_verification_attempt FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hook_password_verification_attempt TO supabase_auth_admin;
