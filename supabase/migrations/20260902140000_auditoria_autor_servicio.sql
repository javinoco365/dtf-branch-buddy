-- ============================================================================
-- AUDITORÍA · Quién escribe cuando escribe el rol de servicio
-- ============================================================================
--
-- QUÉ HACE
--   Añade a auditoria_registrar() una tercera vía para averiguar el autor: la
--   cabecera HTTP x-usuario-id, que PostgREST expone en request.headers y que
--   solo se acepta si la petición viene con el rol de servicio.
--
-- POR QUÉ
--   Hoy el autor sale de app.usuario_id o de auth.uid(). Ninguna de las dos
--   cubre el caso más común de la aplicación: una server function que escribe
--   con supabaseAdmin. Resultado: la mayoría de los cambios quedan con
--   usuario_id NULL. Siendo tres administradores con permisos idénticos, el
--   registro es el único control que hay, y un registro sin autor no controla
--   nada.
--
--     - auth.uid() es NULL, porque el rol de servicio no lleva JWT de usuario.
--     - app.usuario_id no se puede fijar desde fuera: supabaseAdmin habla por
--       PostgREST y cada llamada es su propia transacción. Un set_config
--       previo o no llega a la escritura (si es local a la transacción) o se
--       queda pegado a una conexión del pool y acaba firmando como un usuario
--       lo que escribió otro (si no lo es). Un autor equivocado en un registro
--       de auditoría es peor que ningún autor.
--
--   PostgREST fija request.headers con SET LOCAL, dentro de la misma
--   transacción de la escritura. Eso sí es seguro: no sobrevive a la
--   transacción y no puede contaminar la siguiente petición del pool.
--
-- POR QUÉ NO SE PUEDE FALSIFICAR
--   1. La cabecera solo se mira si auth.uid() es NULL. Un usuario autenticado
--      no puede firmar como otro: su propio JWT gana siempre.
--   2. La cabecera solo se mira si la petición trae el rol de servicio, que
--      exige la clave secreta, que nunca sale del servidor.
--   3. Aunque las dos anteriores fallasen, para dejar un registro falso hay
--      que conseguir escribir en una tabla de negocio, y la RLS no se lo
--      permite a anon. La prueba 20_auditoria_autor.sql lo comprueba.
--
-- QUÉ NO HACE
--   No cambia el orden de las dos vías que ya había, ni toca datos, ni toca
--   estructura. La cabecera se consulta en tercer lugar, después de las dos
--   señales más fiables, para que no pueda pisar a ninguna.
--
-- REVERSIBLE
--   Sí. Volver a la versión anterior de la función es un CREATE OR REPLACE con
--   el cuerpo de 20260902120100_auditoria.sql. No hay migración de datos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- El autor, aislado y comprobable por separado
-- ---------------------------------------------------------------------------
-- Está en su propia función para que la prueba pueda interrogarla sin tener
-- que provocar una escritura real en cada caso.
CREATE OR REPLACE FUNCTION public.auditoria_autor()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_usuario UUID;
  v_es_servicio BOOLEAN := FALSE;
  v_cabeceras JSON;
BEGIN
  -- 1. app.usuario_id: lo fija explícitamente una función SECURITY DEFINER
  --    nuestra dentro de su propia transacción (emitir_factura, anular_factura).
  BEGIN
    v_usuario := NULLIF(current_setting('app.usuario_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_usuario := NULL;
  END;
  IF v_usuario IS NOT NULL THEN
    RETURN v_usuario;
  END IF;

  -- 2. auth.uid(): el JWT del usuario, verificado por Supabase. Es la señal
  --    más fuerte que existe y por eso se mira antes que ninguna cabecera.
  BEGIN
    v_usuario := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_usuario := NULL;
  END;
  IF v_usuario IS NOT NULL THEN
    RETURN v_usuario;
  END IF;

  -- 3. La cabecera x-usuario-id, solo con rol de servicio.
  --
  --    Se comprueban dos señales porque las claves nuevas de Supabase
  --    (sb_secret_...) no son JWT y pueden no poblar request.jwt.claims. El
  --    GUC 'role' lo fija PostgREST con SET LOCAL ROLE y sobrevive a la
  --    entrada en una función SECURITY DEFINER, que cambia current_user pero
  --    no el GUC.
  BEGIN
    v_es_servicio := current_setting('role', true) = 'service_role'
      OR COALESCE(
           NULLIF(current_setting('request.jwt.claims', true), '')::JSON ->> 'role',
           ''
         ) = 'service_role';
  EXCEPTION WHEN OTHERS THEN
    v_es_servicio := FALSE;
  END;

  IF NOT v_es_servicio THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_cabeceras := NULLIF(current_setting('request.headers', true), '')::JSON;
    v_usuario := NULLIF(v_cabeceras ->> 'x-usuario-id', '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    -- Una cabecera con basura no debe tumbar la escritura: se queda sin autor,
    -- que es exactamente la señal que interesa que quede registrada.
    v_usuario := NULL;
  END;

  RETURN v_usuario;
END;
$$;

COMMENT ON FUNCTION public.auditoria_autor() IS
  'Quién está escribiendo, por orden de fiabilidad: app.usuario_id, auth.uid(), '
  'y la cabecera x-usuario-id solo con rol de servicio. NULL significa que '
  'nadie se identificó, y eso es una señal, no un descuido.';

REVOKE EXECUTE ON FUNCTION public.auditoria_autor() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- El trigger, que ahora delega el "quién"
-- ---------------------------------------------------------------------------
-- Idéntico al de 20260902120100_auditoria.sql salvo el bloque del autor, que
-- pasa a ser una llamada a auditoria_autor(). El resto (cerrojo, enmascarado,
-- encadenado por hash) no se toca.
CREATE OR REPLACE FUNCTION public.auditoria_registrar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_antes JSONB;
  v_despues JSONB;
  v_registro TEXT;
  v_empresa UUID;
  v_usuario UUID;
  v_hash_anterior TEXT;
  v_hash TEXT;
  v_momento TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- El encadenado exige un orden total: sin este cerrojo, dos transacciones
  -- simultáneas leerían el mismo hash anterior y la cadena se bifurcaría.
  PERFORM pg_advisory_xact_lock(hashtext('public.auditoria'));

  IF TG_OP = 'DELETE' THEN
    v_antes := public.auditoria_enmascarar(to_jsonb(OLD));
    v_registro := (to_jsonb(OLD) ->> 'id');
  ELSIF TG_OP = 'UPDATE' THEN
    v_antes := public.auditoria_enmascarar(to_jsonb(OLD));
    v_despues := public.auditoria_enmascarar(to_jsonb(NEW));
    v_registro := (to_jsonb(NEW) ->> 'id');
  ELSE
    v_despues := public.auditoria_enmascarar(to_jsonb(NEW));
    v_registro := (to_jsonb(NEW) ->> 'id');
  END IF;

  -- La empresa, si la fila la lleva.
  v_empresa := NULLIF(COALESCE(v_despues, v_antes) ->> 'empresa_id', '')::UUID;

  -- Quién. Ver auditoria_autor() para el orden y por qué es ese.
  v_usuario := public.auditoria_autor();

  SELECT a.hash INTO v_hash_anterior
    FROM public.auditoria a ORDER BY a.id DESC LIMIT 1;

  v_hash := encode(
    extensions.digest(
      COALESCE(v_hash_anterior, '') || '|' ||
      TG_TABLE_NAME || '|' || COALESCE(v_registro, '') || '|' || TG_OP || '|' ||
      COALESCE(v_antes::TEXT, '') || '|' || COALESCE(v_despues::TEXT, '') || '|' ||
      COALESCE(v_usuario::TEXT, '') || '|' || v_momento::TEXT,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.auditoria (
    empresa_id, tabla, registro_id, operacion,
    datos_antes, datos_despues, usuario_id, created_at, hash_anterior, hash
  ) VALUES (
    v_empresa, TG_TABLE_NAME, COALESCE(v_registro, '?'), TG_OP,
    v_antes, v_despues, v_usuario, v_momento, v_hash_anterior, v_hash
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auditoria_registrar() FROM PUBLIC, anon, authenticated;
