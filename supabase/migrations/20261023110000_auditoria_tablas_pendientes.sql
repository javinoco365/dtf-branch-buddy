-- ============================================================================
-- Auditoría: las cinco tablas que escribían sin dejar rastro
-- ============================================================================
--
-- EL PROBLEMA
--   La auditoría (20260902120100 y siguientes) se engancha tabla a tabla con
--   un trigger AFTER INSERT OR UPDATE OR DELETE que llama a
--   auditoria_registrar(). Después de aplicar todas las migraciones, cinco
--   tablas con datos de negocio o de configuración siguen sin él:
--
--     series_facturacion         el contador de cada serie y ejercicio. Lo
--                                cambian emitir_factura() y
--                                factura_borrar_ultima(); un cambio a mano del
--                                último número no dejaba ninguna huella.
--     cliente_tiendas            qué ficha de cliente es qué cliente de cada
--                                tienda WooCommerce.
--     pedido_correos_enviados    qué correo se mandó a quién y cuándo.
--     enlaces_seguimiento        el número de seguimiento de cada envío.
--     tienda_seguimiento_config  el transportista y la cuenta de cada tienda.
--
--   Los tres usuarios son administradores con los mismos permisos: el registro
--   es el único control. Lo que no se registra, no se puede reconstruir.
--
--   (Quedan sin trigger: auditoria, que no se audita a sí misma;
--   auth_intentos_fallidos_login, el contador del límite de intentos de
--   acceso; empresa_global, obsoleta y sustituida por empresas, que sí está
--   auditada; y profiles, el nombre y el correo de cada usuario, que se
--   rellena desde auth.users. Esta última no entra en este arreglo y queda
--   anotada para decidirla aparte.)
--
-- QUÉ HACE
--   1. Añade 'api_key_ref' a auditoria_enmascarar(). tienda_seguimiento_config
--      tiene esa columna; la aplicación no la usa hoy, pero por el nombre
--      puede acabar guardando una clave del transportista, y CLAUDE.md pide
--      que todo campo sensible que entre en el registro vaya enmascarado.
--      Solo afecta a las filas que se registren a partir de ahora: las ya
--      escritas no se tocan, y su huella se calculó sobre lo que se guardó,
--      así que la cadena sigue cuadrando.
--   2. Engancha el trigger <tabla>_auditoria a las cinco tablas, igual que en
--      las demás (DROP TRIGGER IF EXISTS + CREATE TRIGGER).
--
--   No toca la tabla auditoria, ni sus filas, ni auditoria_registrar(), ni
--   auditoria_verificar(). cliente_tiendas no tiene columna id: el registro
--   usa su clave primaria (cliente_id, tienda_id), como ya hace
--   auditoria_identificador() con tienda_usuarios desde 20260902160000.
--
--   Se puede aplicar dos veces.
--
-- QUÉ CAMBIA
--   Cada emisión de factura o ticket deja una fila más en auditoria: la del
--   contador de la serie. Con el autor, porque emitir_factura() ya fija
--   app.usuario_id antes de escribir.
--
-- REVERSIBLE
--   Sí. Quitar los cinco triggers (DROP TRIGGER <tabla>_auditoria ON ...) y
--   volver a crear auditoria_enmascarar() sin 'api_key_ref' lo deja como
--   estaba. Las filas de auditoría que se hayan escrito mientras tanto se
--   quedan: la tabla es append-only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enmascarar api_key_ref
-- ---------------------------------------------------------------------------
-- La misma función de 20260902120100, con una clave más al final de la lista.
CREATE OR REPLACE FUNCTION public.auditoria_enmascarar(datos JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_claves TEXT[] := ARRAY[
    'consumer_key', 'consumer_secret',
    'woo_consumer_key', 'woo_consumer_secret',
    'access_token', 'refresh_token', 'token', 'api_key', 'secret',
    'password', 'service_role_key',
    'api_key_ref'
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
-- 2. Los triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS series_facturacion_auditoria ON public.series_facturacion;
CREATE TRIGGER series_facturacion_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.series_facturacion
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS cliente_tiendas_auditoria ON public.cliente_tiendas;
CREATE TRIGGER cliente_tiendas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.cliente_tiendas
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS pedido_correos_enviados_auditoria ON public.pedido_correos_enviados;
CREATE TRIGGER pedido_correos_enviados_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.pedido_correos_enviados
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS enlaces_seguimiento_auditoria ON public.enlaces_seguimiento;
CREATE TRIGGER enlaces_seguimiento_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.enlaces_seguimiento
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS tienda_seguimiento_config_auditoria ON public.tienda_seguimiento_config;
CREATE TRIGGER tienda_seguimiento_config_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.tienda_seguimiento_config
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
