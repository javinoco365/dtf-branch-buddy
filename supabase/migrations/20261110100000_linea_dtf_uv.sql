-- ============================================================================
-- LÍNEA DE PRODUCTO: DTF Y DTF UV
-- ============================================================================
--
-- QUÉ RESUELVE
--   Desde el 10 de noviembre de 2026 las tiendas venden también DTF UV, por
--   metros, con los mismos productos de WooCommerce de siempre (categoría «DTF
--   UV»). El UV lo imprime y lo envía una subcontrata que cobra 15 € + IVA por
--   metro: no pasa por la máquina propia ni gasta consumibles propios.
--   Hasta ahora todo metro era «metro de DTF»: el UV se sumaba a los metros
--   de la máquina, con el coste por metro del DTF, y sus metros se estimaban
--   con el precio por metro del DTF (112 € ÷ 7 €/m = 16 m, cuando eran 7).
--
-- QUÉ CAMBIA
--   productos.linea: 'dtf' o 'uv', según la categoría de WooCommerce. Nulo
--     mientras no se haya vuelto a sincronizar el catálogo: entonces decide el
--     nombre de la línea del pedido.
--   pedido_items.linea: 'dtf' (por defecto: todo lo de antes) o 'uv'.
--   pedido_items.woo_product_id y sku: el producto de WooCommerce de la línea,
--     que la sincronización recibía y tiraba.
--   pedido_items.metros_origen admite 'cantidad': en el UV vendido sin el
--     montador la cantidad son los metros.
--   pedidos.metros_uv: los metros de UV del pedido. metros_total pasa a ser
--     solo el DTF propio (lo que sale de la máquina).
--   empresas.coste_uv_metro: lo que cobra la subcontrata por metro, sin IVA
--     (15 € por defecto). Se edita en Configuración de la empresa.
--   pedidos.coste_uv_snapshot: ese coste, congelado al crear el pedido, como
--     coste_metro_snapshot con el DTF.
--   pedido_item_coste_congelado(): una línea UV copia coste_uv_snapshot en
--     vez del coste del DTF.
--
-- LO QUE NO TOCA
--   Facturas, tickets, cobros, banco, caja e impuestos. La factura de un
--   pedido UV sale igual que cualquier otra.
--
-- DESPUÉS DE APLICARLA
--   Sincronizar el catálogo y los pedidos de cada tienda: las líneas se
--   rehacen en cada sincronización y salen ya con su línea y sus metros.
--
-- REVERSIBLE
--   Sí. ALTER TABLE ... DROP COLUMN de las seis columnas nuevas, quitar
--   'cantidad' del CHECK de metros_origen y volver a crear
--   pedido_item_coste_congelado() como en 20261007100000. No borra ni cambia
--   ningún dato existente: los pedidos de antes se quedan sin
--   coste_uv_snapshot y sus líneas UV toman el coste de hoy, igual que hace
--   la aplicación con los que no tienen coste_metro_snapshot. Se puede
--   aplicar dos veces sin cambiar nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La línea del producto y de cada línea de pedido
-- ---------------------------------------------------------------------------
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS linea TEXT;
DO $$ BEGIN
  ALTER TABLE public.productos
    ADD CONSTRAINT producto_linea_valida CHECK (linea IS NULL OR linea IN ('dtf', 'uv'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.productos.linea IS
  'Línea de producto: dtf (impresión propia) o uv (DTF UV, subcontratado). Sale de la categoría de WooCommerce. Nulo si aún no se sabe.';

ALTER TABLE public.pedido_items
  ADD COLUMN IF NOT EXISTS linea TEXT NOT NULL DEFAULT 'dtf',
  ADD COLUMN IF NOT EXISTS woo_product_id BIGINT,
  ADD COLUMN IF NOT EXISTS sku TEXT;
DO $$ BEGIN
  ALTER TABLE public.pedido_items
    ADD CONSTRAINT pedido_item_linea_valida CHECK (linea IN ('dtf', 'uv'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.pedido_items.linea IS
  'Línea de producto de la línea del pedido: dtf o uv.';
COMMENT ON COLUMN public.pedido_items.woo_product_id IS
  'Producto de WooCommerce de la línea (product_id). Nulo en las líneas manuales y en las de antes.';

-- 'cantidad': metros que son la cantidad de la línea (UV sin montador).
ALTER TABLE public.pedido_items DROP CONSTRAINT IF EXISTS pedido_item_metros_origen;
ALTER TABLE public.pedido_items
  ADD CONSTRAINT pedido_item_metros_origen
  CHECK (metros_origen IS NULL
         OR metros_origen IN ('montador', 'precio_linea', 'precio_ajustes', 'cantidad'));

-- ---------------------------------------------------------------------------
-- 2. Metros de UV del pedido
-- ---------------------------------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS metros_uv NUMERIC(12,3) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.pedidos
    ADD CONSTRAINT pedido_metros_uv_valido CHECK (metros_uv >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.pedidos.metros_uv IS
  'Metros de DTF UV del pedido (subcontratado). metros_total es solo el DTF propio.';

-- ---------------------------------------------------------------------------
-- 3. Coste del UV: el de la empresa y el congelado en cada pedido
-- ---------------------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS coste_uv_metro NUMERIC(12,4) NOT NULL DEFAULT 15;
DO $$ BEGIN
  ALTER TABLE public.empresas
    ADD CONSTRAINT empresa_coste_uv_metro_valido CHECK (coste_uv_metro >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.empresas.coste_uv_metro IS
  'Lo que cobra la subcontrata por metro de DTF UV, sin IVA.';

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS coste_uv_snapshot NUMERIC(12,4);
COMMENT ON COLUMN public.pedidos.coste_uv_snapshot IS
  'Coste por metro de DTF UV al crear el pedido. No cambia después.';

CREATE OR REPLACE FUNCTION public.pedido_coste_uv_congelado()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.coste_uv_snapshot IS NULL THEN
      SELECT coste_uv_metro INTO NEW.coste_uv_snapshot
        FROM public.empresas WHERE id = NEW.empresa_id;
    END IF;
  ELSIF OLD.coste_uv_snapshot IS NOT NULL THEN
    NEW.coste_uv_snapshot := OLD.coste_uv_snapshot;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_coste_uv_congelado ON public.pedidos;
CREATE TRIGGER pedidos_coste_uv_congelado
  BEFORE INSERT OR UPDATE OF coste_uv_snapshot ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_coste_uv_congelado();

-- Las líneas UV copian el coste del UV; el resto, como hasta ahora.
CREATE OR REPLACE FUNCTION public.pedido_item_coste_congelado()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.coste_unit_snapshot IS NULL THEN
    IF NEW.linea = 'uv' THEN
      -- El del pedido; uno de antes de esta migración no lo tiene: el de hoy.
      SELECT COALESCE(p.coste_uv_snapshot, e.coste_uv_metro) INTO NEW.coste_unit_snapshot
        FROM public.pedidos p JOIN public.empresas e ON e.id = p.empresa_id
       WHERE p.id = NEW.pedido_id;
    ELSIF lower(COALESCE(NEW.unidad, 'm')) = 'm' THEN
      SELECT coste_metro_snapshot INTO NEW.coste_unit_snapshot
        FROM public.pedidos WHERE id = NEW.pedido_id;
    ELSE
      NEW.coste_unit_snapshot := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
