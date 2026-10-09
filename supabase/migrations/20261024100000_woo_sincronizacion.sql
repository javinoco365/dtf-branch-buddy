-- ============================================================================
-- WooCommerce: por dónde va la sincronización de cada tienda
-- ============================================================================
--
-- EL PROBLEMA
--   La sincronización con WooCommerce pedía una sola página: los 100 pedidos
--   más recientes, 100 clientes y 100 productos. Si entre dos sincronizaciones
--   entraban más de 100 pedidos, los más antiguos de ese tramo no llegaban
--   nunca. Y un pedido viejo que cambiaba de estado en WooCommerce no se
--   actualizaba aquí si ya no estaba entre los 100 últimos.
--
--   No se guardaba en ningún sitio cuándo fue la última sincronización: ni en
--   tiendas ni en ninguna otra tabla. Cada vez se empezaba de cero.
--
-- QUÉ HACE
--   Crea public.woo_sincronizacion, una fila por tienda, con el cursor:
--     pedidos_hasta    fecha de modificación (GMT) del último pedido traído.
--     productos_hasta  lo mismo para los productos.
--   La sincronización pide a WooCommerce solo lo modificado desde ahí, todas
--   las páginas que haga falta, por tandas, y deja el cursor donde se quedó
--   después de cada página. Si una tanda se corta, la siguiente sigue desde
--   ahí.
--
--   La primera vez, el cursor de pedidos (un día antes del último pedido de
--   WooCommerce que ya hay aquí) se guarda ANTES de traer nada: si se
--   calculara otra vez en la llamada siguiente, ya con los 100 últimos
--   dentro, se saltaría los pedidos de entre medias. NULL es «nunca se ha
--   guardado»; «desde el principio» (ningún pedido aquí todavía) se guarda
--   como 1970-01-01 00:00 UTC.
--
--   Los clientes no necesitan columna: WooCommerce no deja filtrarlos por
--   fecha, y el cursor de clientes es el woo_customer_id más alto que ya está
--   en public.clientes para esa tienda.
--
-- POR QUÉ UNA TABLA Y NO COLUMNAS EN tiendas
--   tiendas está en la auditoría: cada página sincronizada escribiría una fila
--   de auditoría con la tienda entera, antes y después. El cursor no es un dato
--   de negocio, es por dónde va un proceso, y no se audita.
--
-- PERMISOS
--   RLS activada, una política por operación. Los usuarios de la empresa solo
--   la LEEN. No hay política de alta, edición ni baja: solo la escribe la
--   sincronización, en el servidor, con la clave de servicio, que no pasa por
--   la RLS.
--
-- SIN ESTA MIGRACIÓN
--   La aplicación funciona igual: sin cursor guardado, empieza un día antes
--   del pedido de WooCommerce más reciente que ya hay aquí, y la pantalla de
--   Ajustes lleva el cursor de una tanda a la siguiente. Lo único que se
--   pierde es poder cortar una sincronización muy larga y seguirla otro día
--   desde el botón de Pedidos.
--
-- NO TOCA NINGUNA FILA EXISTENTE. Se puede aplicar dos veces.
--
-- REVERSIBLE
--   Sí: DROP TABLE public.woo_sincronizacion; (pídelo antes: es un DROP). Solo
--   se pierde el cursor; la siguiente sincronización vuelve a calcularlo desde
--   el pedido más reciente, y lo que se repita se guarda igual (el upsert por
--   tienda_id + woo_order_id es idempotente).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.woo_sincronizacion (
  tienda_id UUID PRIMARY KEY REFERENCES public.tiendas(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  pedidos_hasta TIMESTAMPTZ,
  productos_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.woo_sincronizacion IS
  'Por dónde va la sincronización con WooCommerce de cada tienda. La escribe solo '
  'sincronizarWoo con la clave de servicio. No es un dato de negocio y no se audita.';
COMMENT ON COLUMN public.woo_sincronizacion.pedidos_hasta IS
  'Fecha de modificación (GMT) del último pedido de WooCommerce traído. La siguiente '
  'sincronización pide lo modificado desde un segundo antes. 1970-01-01 00:00 UTC: desde '
  'el principio. NULL: nunca se ha guardado.';
COMMENT ON COLUMN public.woo_sincronizacion.productos_hasta IS
  'Fecha de modificación (GMT) del último producto de WooCommerce traído. 1970-01-01 '
  '00:00 UTC: desde el principio. NULL: nunca se ha guardado.';

DROP TRIGGER IF EXISTS woo_sincronizacion_touch ON public.woo_sincronizacion;
CREATE TRIGGER woo_sincronizacion_touch BEFORE UPDATE ON public.woo_sincronizacion
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permisos: lectura para la empresa; escritura solo con la clave de servicio
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.woo_sincronizacion FROM anon, authenticated;
GRANT SELECT ON public.woo_sincronizacion TO authenticated;
GRANT ALL ON public.woo_sincronizacion TO service_role;

ALTER TABLE public.woo_sincronizacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "woo sincronizacion lectura" ON public.woo_sincronizacion;
CREATE POLICY "woo sincronizacion lectura" ON public.woo_sincronizacion
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Sin políticas de INSERT, UPDATE ni DELETE, a propósito: ver PERMISOS arriba.
