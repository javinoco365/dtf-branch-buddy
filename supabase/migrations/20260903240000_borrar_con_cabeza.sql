-- ============================================================================
-- Borrar con cabeza: se puede eliminar todo, menos lo que la ley no deja
-- ============================================================================
--
-- QUÉ SE PIDE
--   Poder editar y eliminar cualquier cosa desde la aplicación, con un aviso
--   antes. Hasta ahora media pantalla no tenía botón de borrar y la otra media
--   borraba sin decir qué se llevaba por delante.
--
-- QUÉ NO SE PUEDE, Y NO ES OPINABLE
--   Una factura emitida no se borra (ya lo impide factura_inmutable()). Y por
--   lo mismo, tampoco se borra la TIENDA de la que cuelgan facturas emitidas:
--   facturas.tienda_id es ON DELETE SET NULL, así que borrarla no destruiría el
--   documento, pero lo dejaría huérfano y sin saber de qué web salió. Para eso
--   está desactivar: la tienda desaparece del día a día y sus facturas siguen
--   sabiendo de dónde vienen.
--
-- QUÉ AÑADE ESTO
--   1. tiendas.activa            desactivar en vez de borrar.
--   2. tienda_borrado_permitido  el freno, en la base y no solo en la pantalla.
--   3. tienda_resumen_borrado    qué se lleva por delante, para poder avisar
--                                con números en vez de con un «¿seguro?».
--   4. Políticas por operación en tiendas, que estaba en FOR ALL.
--
-- REVERSIBLE
--   Sí. Una columna, un trigger, una función y cuatro políticas.
-- ============================================================================

ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tiendas.activa IS
  'Una tienda desactivada no aparece en el menú ni sincroniza, pero sus '
  'facturas siguen colgando de ella. Es la salida para las que no se pueden '
  'borrar.';

-- ---------------------------------------------------------------------------
-- El freno, en la base
-- ---------------------------------------------------------------------------
-- Vive aquí y no en la server function porque las pantallas hablan con
-- PostgREST con la clave anónima: cualquiera con sesión puede lanzar un DELETE
-- sin pasar por el servidor de la aplicación. Si la regla solo estuviera arriba,
-- no sería una regla.
CREATE OR REPLACE FUNCTION public.tienda_borrado_permitido()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_facturas INT;
BEGIN
  SELECT count(*) INTO v_facturas
    FROM public.facturas f
   WHERE f.tienda_id = OLD.id AND f.estado <> 'borrador';

  IF v_facturas > 0 THEN
    RAISE EXCEPTION
      'La tienda % tiene % factura(s) emitida(s) y no se puede borrar. Desactívala.',
      OLD.nombre, v_facturas
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tiendas_borrado_permitido ON public.tiendas;
CREATE TRIGGER tiendas_borrado_permitido
  BEFORE DELETE ON public.tiendas
  FOR EACH ROW EXECUTE FUNCTION public.tienda_borrado_permitido();

-- ---------------------------------------------------------------------------
-- Qué se lleva por delante
-- ---------------------------------------------------------------------------
-- Para que el aviso diga «se van a borrar 143 pedidos y 87 clientes» en vez de
-- «¿seguro?». Un «¿seguro?» sin números se contesta que sí sin leerlo.
CREATE OR REPLACE FUNCTION public.tienda_resumen_borrado(_tienda_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'nombre',            (SELECT nombre FROM public.tiendas WHERE id = _tienda_id),
    'facturas_emitidas', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado <> 'borrador'),
    'facturas_borrador', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado = 'borrador'),
    'pedidos',           (SELECT count(*) FROM public.pedidos WHERE tienda_id = _tienda_id),
    'clientes',          (SELECT count(*) FROM public.clientes WHERE tienda_id = _tienda_id),
    'productos',         (SELECT count(*) FROM public.productos WHERE tienda_id = _tienda_id),
    'proyectos',         (SELECT count(*) FROM public.proyectos WHERE tienda_id = _tienda_id)
  );
$$;

COMMENT ON FUNCTION public.tienda_resumen_borrado(UUID) IS
  'Lo que arrastraría borrar una tienda. Si facturas_emitidas > 0 no se puede '
  'borrar: hay que desactivarla.';

REVOKE EXECUTE ON FUNCTION public.tienda_resumen_borrado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tienda_resumen_borrado(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Políticas por operación
-- ---------------------------------------------------------------------------
-- «tiendas admin write» era FOR ALL. Un FOR ALL no se lee: no se sabe si
-- borrar estaba permitido a propósito o de rebote. Cuatro políticas dicen
-- exactamente qué se puede hacer.
DROP POLICY IF EXISTS "tiendas admin write" ON public.tiendas;

DROP POLICY IF EXISTS "tiendas alta" ON public.tiendas;
CREATE POLICY "tiendas alta" ON public.tiendas
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tiendas edicion" ON public.tiendas;
CREATE POLICY "tiendas edicion" ON public.tiendas
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Se permite, pero el trigger de arriba decide cuándo.
DROP POLICY IF EXISTS "tiendas baja" ON public.tiendas;
CREATE POLICY "tiendas baja" ON public.tiendas
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
