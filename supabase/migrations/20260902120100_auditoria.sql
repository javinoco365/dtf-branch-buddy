-- ============================================================================
-- CIMIENTOS 2/6 · Auditoría append-only encadenada por hash
-- ============================================================================
--
-- QUÉ HACE
--   Crea public.auditoria, la escribe por trigger en las tablas de negocio,
--   encadena cada fila con la anterior por SHA-256 y enmascara los campos
--   sensibles antes de guardarlos.
--
-- POR QUÉ
--   Los tres usuarios son administradores con permisos idénticos. No hay
--   separación de funciones posible, así que el único control es el registro:
--   quién cambió qué y cuándo. Hoy no existe ninguno.
--
-- ESTO NO ES VERIFACTU
--   El encadenado de aquí es un registro interno de cambios. La huella y el
--   encadenamiento que exige Verifactu son otra cosa: los produce el proveedor
--   certificado sobre los registros de facturación, y DTI no los implementa
--   para no convertirse en productora de SIF. No mezclar los dos conceptos ni
--   reutilizar esta tabla para lo fiscal.
--
-- REVERSIBLE
--   Sí, mientras no haya filas que valga la pena conservar. Eliminar los
--   triggers, las funciones y la tabla la deshace por completo.
-- ============================================================================

-- pgcrypto para digest(); en Supabase suele estar ya instalada.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auditoria (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID,
  tabla TEXT NOT NULL,
  registro_id TEXT NOT NULL,
  operacion TEXT NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
  datos_antes JSONB,
  datos_despues JSONB,
  -- Quién. Sale de app.usuario_id, que fija la server function antes de
  -- escribir. NULL significa que alguien escribió sin identificarse: es una
  -- señal, no un hueco aceptable.
  usuario_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash_anterior TEXT,
  hash TEXT NOT NULL
);

COMMENT ON TABLE public.auditoria IS
  'Registro de cambios append-only, encadenado por hash. Escrito solo por trigger. No se modifica jamás.';
COMMENT ON COLUMN public.auditoria.usuario_id IS
  'Viene de app.usuario_id. Si es NULL, el cambio se hizo sin fijar la identidad.';

CREATE INDEX IF NOT EXISTS auditoria_tabla_registro_idx
  ON public.auditoria (tabla, registro_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_usuario_idx
  ON public.auditoria (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_empresa_idx
  ON public.auditoria (empresa_id, created_at DESC);

-- Nadie escribe a mano. Ni siquiera para insertar.
REVOKE ALL ON public.auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.auditoria TO authenticated;
GRANT SELECT ON public.auditoria TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.auditoria FROM service_role;

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auditoria lectura admin" ON public.auditoria;
CREATE POLICY "auditoria lectura admin" ON public.auditoria
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Enmascarado de campos sensibles
-- ---------------------------------------------------------------------------
-- Una credencial de WooCommerce en claro dentro del log de auditoría es la
-- misma credencial en claro, solo que en otra tabla y para siempre.
--
-- AL AÑADIR UN CAMPO SENSIBLE NUEVO, AÑÁDELO AQUÍ.
CREATE OR REPLACE FUNCTION public.auditoria_enmascarar(datos JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_claves TEXT[] := ARRAY[
    'consumer_key', 'consumer_secret',
    'woo_consumer_key', 'woo_consumer_secret',
    'access_token', 'refresh_token', 'token', 'api_key', 'secret',
    'password', 'service_role_key'
  ];
  v_clave TEXT;
BEGIN
  IF datos IS NULL THEN RETURN NULL; END IF;

  FOREACH v_clave IN ARRAY v_claves LOOP
    IF datos ? v_clave AND datos ->> v_clave IS NOT NULL THEN
      datos := jsonb_set(datos, ARRAY[v_clave], to_jsonb('«oculto»'::text));
    END IF;
  END LOOP;

  RETURN datos;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. El trigger que registra
-- ---------------------------------------------------------------------------
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

  -- Quién, por orden de fiabilidad:
  --   1. app.usuario_id, que fija explícitamente quien escribe desde una
  --      función de servidor con el rol de servicio.
  --   2. auth.uid(), que existe siempre que la petición lleve el JWT del
  --      usuario. Cubre todo lo que la aplicación escribe con el cliente del
  --      navegador o con context.supabase.
  --   3. NULL, que significa que nadie se identificó. Es una señal.
  --
  -- El respaldo por JWT importa porque supabaseAdmin habla por PostgREST: cada
  -- llamada es su propia transacción, así que un set_config en una petición no
  -- sobrevive a la siguiente. Fijar app.usuario_id solo funciona dentro de una
  -- función de base de datos que haga las dos cosas en la misma transacción,
  -- que es el patrón que traerá emitir_factura() en la fase de facturación.
  BEGIN
    v_usuario := NULLIF(current_setting('app.usuario_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_usuario := NULL;
  END;

  IF v_usuario IS NULL THEN
    BEGIN
      v_usuario := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_usuario := NULL;
    END;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 4. Append-only de verdad
-- ---------------------------------------------------------------------------
-- Los permisos ya lo impiden, pero el propietario de la tabla y cualquier
-- función SECURITY DEFINER se los saltan. Este trigger no.
CREATE OR REPLACE FUNCTION public.auditoria_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría es append-only: no se puede % una fila ya registrada', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS auditoria_inmutable_trg ON public.auditoria;
CREATE TRIGGER auditoria_inmutable_trg
  BEFORE UPDATE OR DELETE ON public.auditoria
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_inmutable();

-- ---------------------------------------------------------------------------
-- 5. Enganchar el trigger a las tablas de negocio
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tabla TEXT;
  v_auditadas TEXT[] := ARRAY[
    'empresas', 'tiendas', 'tienda_usuarios', 'tienda_credenciales',
    'clientes', 'productos',
    'pedidos', 'pedido_items', 'pedido_devoluciones',
    'facturas', 'factura_items',
    'proyectos', 'user_roles',
    'textil_marcas', 'textil_stock', 'textil_clientes',
    'textil_presupuestos', 'textil_presupuesto_items',
    'textil_pedidos', 'textil_pedido_items',
    'textil_facturas', 'textil_factura_items'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_auditadas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tabla
    ) THEN
      RAISE NOTICE 'La tabla % no existe, se omite', v_tabla;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
      v_tabla || '_auditoria', v_tabla);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar()',
      v_tabla || '_auditoria', v_tabla);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Verificación de la cadena
-- ---------------------------------------------------------------------------
-- Recalcula la cadena entera y devuelve la primera fila que no cuadre.
-- Sin filas devueltas, la cadena está intacta.
CREATE OR REPLACE FUNCTION public.auditoria_verificar()
RETURNS TABLE (id BIGINT, motivo TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_esperado TEXT;
  v_anterior TEXT := NULL;
BEGIN
  FOR r IN SELECT * FROM public.auditoria ORDER BY public.auditoria.id LOOP
    IF r.hash_anterior IS DISTINCT FROM v_anterior THEN
      id := r.id;
      motivo := 'El hash anterior no coincide con el de la fila precedente';
      RETURN NEXT;
    END IF;

    v_esperado := encode(
      extensions.digest(
        COALESCE(r.hash_anterior, '') || '|' ||
        r.tabla || '|' || r.registro_id || '|' || r.operacion || '|' ||
        COALESCE(r.datos_antes::TEXT, '') || '|' || COALESCE(r.datos_despues::TEXT, '') || '|' ||
        COALESCE(r.usuario_id::TEXT, '') || '|' || r.created_at::TEXT,
        'sha256'
      ),
      'hex'
    );

    IF v_esperado IS DISTINCT FROM r.hash THEN
      id := r.id;
      motivo := 'El contenido de la fila no corresponde a su hash';
      RETURN NEXT;
    END IF;

    v_anterior := r.hash;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auditoria_verificar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_verificar() TO authenticated;
