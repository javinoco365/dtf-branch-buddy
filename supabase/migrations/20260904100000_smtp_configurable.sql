-- ============================================================================
-- CORREO · El servidor SMTP se configura desde la aplicación
-- ============================================================================
--
-- QUÉ FALTA
--   Desde Ajustes de una tienda se puede poner el remitente y escribir la
--   plantilla, pero NO el servidor de correo: host, puerto, usuario y clave
--   solo salían de variables de entorno. Configurarlo obligaba a entrar en
--   Vercel y volver a desplegar, que no es «configurarlo desde la aplicación».
--
-- DÓNDE VA LA CLAVE
--   En Vault, como las de WooCommerce. Host, puerto y usuario son texto normal
--   —el usuario de Resend es literalmente «resend»—, pero la contraseña es la
--   clave de API del proveedor: con ella se manda correo en nombre del dominio.
--   No entra en ninguna columna en claro y no vuelve nunca al navegador.
--
-- GENERAL Y POR TIENDA
--   Una fila con tienda_id NULL es la configuración general, y es la que se usa
--   salvo que una tienda tenga la suya. Es lo normal: una cuenta de Resend con
--   varios dominios verificados y un remitente distinto por tienda. Poder
--   separarlas existe para el día que una tienda tenga su propio proveedor, sin
--   obligar hoy a teclear lo mismo dos veces.
--
-- REVERSIBLE
--   Sí. Una tabla y tres funciones. No toca nada existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.smtp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  -- NULL = la configuración general de la sociedad.
  tienda_id UUID REFERENCES public.tiendas(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  puerto INT NOT NULL DEFAULT 465,
  usuario TEXT NOT NULL,
  -- La contraseña NO está aquí: esto es la referencia al secreto en Vault.
  clave_secret_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT smtp_puerto_valido CHECK (puerto BETWEEN 1 AND 65535),
  CONSTRAINT smtp_host_no_vacio CHECK (btrim(host) <> '')
);

COMMENT ON TABLE public.smtp_config IS
  'Servidor de correo saliente. Una fila con tienda_id NULL es la general; una '
  'con tienda_id la sustituye para esa tienda. La contraseña vive en Vault.';

-- Una general por sociedad, y una por tienda como mucho. Con índices parciales
-- porque en un UNIQUE normal dos NULL no chocan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS smtp_general_unica
  ON public.smtp_config (empresa_id) WHERE tienda_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS smtp_por_tienda_unica
  ON public.smtp_config (tienda_id) WHERE tienda_id IS NOT NULL;

DROP TRIGGER IF EXISTS smtp_config_touch ON public.smtp_config;
CREATE TRIGGER smtp_config_touch
  BEFORE UPDATE ON public.smtp_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Guardar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smtp_guardar(
  _empresa_id UUID,
  _tienda_id UUID,
  _host TEXT,
  _puerto INT,
  _usuario TEXT,
  _clave TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_secreto UUID;
  v_nombre TEXT := 'smtp_' || COALESCE(_tienda_id::TEXT, 'general_' || _empresa_id::TEXT);
BEGIN
  SELECT clave_secret_id INTO v_secreto
    FROM public.smtp_config
   WHERE empresa_id = _empresa_id
     AND tienda_id IS NOT DISTINCT FROM _tienda_id;

  -- Clave vacía = «no la cambies». Así se puede corregir el puerto sin tener
  -- que volver a teclear la contraseña, que además la pantalla no conoce.
  IF COALESCE(_clave, '') <> '' THEN
    IF v_secreto IS NULL THEN
      v_secreto := vault.create_secret(_clave, v_nombre, 'Contraseña SMTP');
    ELSE
      PERFORM vault.update_secret(v_secreto, _clave);
    END IF;
  END IF;

  IF v_secreto IS NULL THEN
    RAISE EXCEPTION 'Hace falta la contraseña la primera vez que se configura el correo';
  END IF;

  -- Sin ON CONFLICT: los índices son parciales y no sirven de destino de un
  -- upsert. Se mira y se decide, que además se lee mejor.
  IF EXISTS (
    SELECT 1 FROM public.smtp_config
     WHERE empresa_id = _empresa_id AND tienda_id IS NOT DISTINCT FROM _tienda_id
  ) THEN
    UPDATE public.smtp_config
       SET host = btrim(_host),
           puerto = _puerto,
           usuario = btrim(_usuario),
           clave_secret_id = v_secreto
     WHERE empresa_id = _empresa_id
       AND tienda_id IS NOT DISTINCT FROM _tienda_id;
  ELSE
    INSERT INTO public.smtp_config (empresa_id, tienda_id, host, puerto, usuario, clave_secret_id)
    VALUES (_empresa_id, _tienda_id, btrim(_host), _puerto, btrim(_usuario), v_secreto);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.smtp_guardar(UUID, UUID, TEXT, INT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smtp_guardar(UUID, UUID, TEXT, INT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Leer, con la clave. Solo el rol de servicio.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smtp_leer(_tienda_id UUID)
RETURNS TABLE (host TEXT, puerto INT, usuario TEXT, clave TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- La general que se coge es la de la MISMA sociedad que la tienda, no
  -- cualquiera: hoy hay una empresa, pero el modelo tiene que aguantar varias
  -- sin migración.
  SELECT c.host, c.puerto, c.usuario, s.decrypted_secret
    FROM public.smtp_config c
    LEFT JOIN vault.decrypted_secrets s ON s.id = c.clave_secret_id
   WHERE c.tienda_id = _tienda_id
      OR (c.tienda_id IS NULL
          AND c.empresa_id = (SELECT t.empresa_id FROM public.tiendas t WHERE t.id = _tienda_id))
   -- La de la tienda gana a la general.
   ORDER BY c.tienda_id NULLS LAST
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.smtp_leer(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smtp_leer(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Qué hay configurado, sin la clave. Esto sí lo puede pedir la pantalla.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smtp_estado(_tienda_id UUID DEFAULT NULL)
RETURNS TABLE (ambito TEXT, host TEXT, puerto INT, usuario TEXT, tiene_clave BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN c.tienda_id IS NULL THEN 'general' ELSE 'tienda' END,
         c.host, c.puerto, c.usuario, c.clave_secret_id IS NOT NULL
    FROM public.smtp_config c
   WHERE (_tienda_id IS NOT NULL
          AND (c.tienda_id = _tienda_id
               OR (c.tienda_id IS NULL
                   AND c.empresa_id = (SELECT t.empresa_id FROM public.tiendas t
                                        WHERE t.id = _tienda_id))))
      OR (_tienda_id IS NULL AND c.tienda_id IS NULL)
   ORDER BY c.tienda_id NULLS LAST
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.smtp_estado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.smtp_estado(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Quitar la configuración propia de una tienda: vuelve a usar la general.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smtp_borrar_tienda(_tienda_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_borradas INT;
BEGIN
  -- El secreto de Vault se queda: borrarlo desde aquí sería borrar una clave
  -- que quizá comparte otra fila. Sin referencia, es inaccesible.
  DELETE FROM public.smtp_config WHERE tienda_id = _tienda_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  RETURN v_borradas > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.smtp_borrar_tienda(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smtp_borrar_tienda(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
-- Sin ningún permiso para authenticated: todo pasa por las funciones de
-- arriba. Un SELECT directo no enseñaría la clave —solo el identificador del
-- secreto— pero tampoco hay motivo para dejarlo abierto.
REVOKE ALL ON public.smtp_config FROM authenticated, anon;
GRANT ALL ON public.smtp_config TO service_role;

ALTER TABLE public.smtp_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS smtp_config_auditoria ON public.smtp_config;
CREATE TRIGGER smtp_config_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.smtp_config
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
