-- ============================================================================
-- Cifras fiables: cobro web neto de devoluciones y coste congelado por pedido
-- ============================================================================
--
-- Qué hace
--
--   1. El cobro web resta lo devuelto. Hasta ahora, un pedido de WooCommerce
--      de 100 € con 30 € reembolsados seguía teniendo un cobro web de 100 €,
--      y la Facturación Consolidada contaba como cobrado un dinero que se
--      había devuelto. Ahora el cobro web es total − devoluciones, y se pone
--      al día también cuando llega una devolución nueva (trigger sobre
--      pedido_devoluciones). Si se devuelve todo, el cobro web desaparece.
--      Los cobros de los pedidos con devoluciones ya existentes se recalculan
--      al aplicar la migración.
--
--   2. El coste por metro se congela en cada pedido. El margen se calculaba
--      con el coste de hoy (Ajustes › Datos de la empresa) también para los
--      meses pasados, así que al cambiarlo cambiaba el margen de todo el
--      historial. Ahora:
--        - pedidos.coste_metro_snapshot: el coste por metro (consumibles +
--          packaging + electricidad) en el momento de crear el pedido. Se
--          pone solo al insertar y ya no cambia: un UPDATE no lo toca.
--        - pedido_items.coste_unit_snapshot: el coste unitario de la línea,
--          copiado del pedido (las líneas en metros) o 0 (el resto). Se toma
--          del pedido y no de la empresa porque la sincronización con
--          WooCommerce borra y vuelve a escribir las líneas en cada pasada:
--          si las líneas leyeran el coste de hoy, se descongelarían solas.
--      Los pedidos que ya existen se congelan con el coste actual, que es el
--      único que se conoce. Eso escribe una fila de auditoría por pedido.
--
-- Qué NO hace: no toca importes de pedidos, cobros manuales ni facturas.
--
-- Reversible: sí.
--   - Volver a crear pedido_cobro_web() como estaba en 20260929100000_cobros
--     y borrar el trigger pedido_devoluciones_cobro_web y la función
--     cobro_web_al_dia(). Los cobros web vuelven a su total en la siguiente
--     sincronización.
--   - Borrar los triggers pedidos_coste_congelado y
--     pedido_items_coste_congelado, sus funciones, coste_metro_empresa() y
--     las dos columnas. La aplicación funciona sin ellas: usa el coste actual.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cobro web neto de devoluciones
-- ---------------------------------------------------------------------------
-- Una sola función que deja el cobro web de un pedido como debe estar. La
-- llaman el trigger de pedidos (como antes) y el nuevo de devoluciones.
CREATE OR REPLACE FUNCTION public.cobro_web_al_dia(_pedido_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.pedidos;
  v_devuelto NUMERIC;
  v_importe NUMERIC;
BEGIN
  SELECT * INTO p FROM public.pedidos WHERE id = _pedido_id;
  IF NOT FOUND THEN
    RETURN; -- el pedido se está borrando: sus cobros automáticos ya se fueron
  END IF;

  SELECT COALESCE(sum(importe), 0) INTO v_devuelto
    FROM public.pedido_devoluciones WHERE pedido_id = _pedido_id;
  v_importe := round(p.total - v_devuelto, 2);

  IF p.origen = 'woocommerce'
     AND p.cancelado_en IS NULL
     AND p.estado_pago IN ('pagado', 'parcial')
     AND v_importe > 0
  THEN
    INSERT INTO public.cobros
      (empresa_id, pedido_id, fecha, importe, metodo, automatico)
    VALUES
      (p.empresa_id, p.id, (p.fecha_pedido AT TIME ZONE 'Europe/Madrid')::DATE,
       v_importe, 'web', true)
    ON CONFLICT (pedido_id) WHERE metodo = 'web' DO UPDATE
      SET importe = EXCLUDED.importe, fecha = EXCLUDED.fecha
      WHERE public.cobros.importe IS DISTINCT FROM EXCLUDED.importe
         OR public.cobros.fecha IS DISTINCT FROM EXCLUDED.fecha;
  ELSE
    DELETE FROM public.cobros WHERE pedido_id = _pedido_id AND metodo = 'web';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.cobro_web_al_dia(UUID) IS
  'Deja el cobro web de un pedido de WooCommerce en su total menos lo devuelto, o lo borra si no toca.';

REVOKE ALL ON FUNCTION public.cobro_web_al_dia(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cobro_web_al_dia(UUID) TO service_role;

-- El trigger de pedidos de siempre, ahora a través de la función común.
CREATE OR REPLACE FUNCTION public.pedido_cobro_web()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.cobro_web_al_dia(NEW.id);
  RETURN NULL;
END;
$$;

-- Y uno nuevo: cuando llega, cambia o se va una devolución.
CREATE OR REPLACE FUNCTION public.pedido_devolucion_cobro_web()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.cobro_web_al_dia(OLD.pedido_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.pedido_id <> OLD.pedido_id) THEN
    PERFORM public.cobro_web_al_dia(NEW.pedido_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pedido_devoluciones_cobro_web ON public.pedido_devoluciones;
CREATE TRIGGER pedido_devoluciones_cobro_web
  AFTER INSERT OR UPDATE OF importe, pedido_id OR DELETE ON public.pedido_devoluciones
  FOR EACH ROW EXECUTE FUNCTION public.pedido_devolucion_cobro_web();

-- Los pedidos que ya tienen devoluciones.
SELECT public.cobro_web_al_dia(d.pedido_id)
  FROM (SELECT DISTINCT pedido_id FROM public.pedido_devoluciones) d;

-- ---------------------------------------------------------------------------
-- 2. Coste por metro congelado en el pedido y en sus líneas
-- ---------------------------------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS coste_metro_snapshot NUMERIC(12,4);
COMMENT ON COLUMN public.pedidos.coste_metro_snapshot IS
  'Coste de producción por metro (consumibles + packaging + electricidad) al crear el pedido. No cambia después.';

ALTER TABLE public.pedido_items
  ADD COLUMN IF NOT EXISTS coste_unit_snapshot NUMERIC(12,4);
COMMENT ON COLUMN public.pedido_items.coste_unit_snapshot IS
  'Coste por unidad congelado: el del pedido si la línea va en metros, 0 si no.';

CREATE OR REPLACE FUNCTION public.coste_metro_empresa(_empresa_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(coste_consumibles_metro, 0)
       + COALESCE(coste_packaging_metro, 0)
       + COALESCE(coste_electricidad_metro, 0)
    FROM public.empresas WHERE id = _empresa_id;
$$;

-- Al crear el pedido, el coste de ese momento. Después, nadie lo cambia: ni
-- la aplicación ni el upsert de la sincronización (que tampoco lo envía).
CREATE OR REPLACE FUNCTION public.pedido_coste_congelado()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.coste_metro_snapshot IS NULL THEN
      NEW.coste_metro_snapshot := public.coste_metro_empresa(NEW.empresa_id);
    END IF;
  ELSIF OLD.coste_metro_snapshot IS NOT NULL THEN
    NEW.coste_metro_snapshot := OLD.coste_metro_snapshot;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_coste_congelado ON public.pedidos;
CREATE TRIGGER pedidos_coste_congelado
  BEFORE INSERT OR UPDATE OF coste_metro_snapshot ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_coste_congelado();

-- Las líneas copian el coste del pedido, no el de hoy.
CREATE OR REPLACE FUNCTION public.pedido_item_coste_congelado()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.coste_unit_snapshot IS NULL THEN
    IF lower(COALESCE(NEW.unidad, 'm')) = 'm' THEN
      SELECT coste_metro_snapshot INTO NEW.coste_unit_snapshot
        FROM public.pedidos WHERE id = NEW.pedido_id;
    ELSE
      NEW.coste_unit_snapshot := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedido_items_coste_congelado ON public.pedido_items;
CREATE TRIGGER pedido_items_coste_congelado
  BEFORE INSERT ON public.pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.pedido_item_coste_congelado();

-- Lo que ya existe, con el coste de hoy: es el único que se conoce. Primero
-- los pedidos y después sus líneas, que lo copian del pedido.
UPDATE public.pedidos
   SET coste_metro_snapshot = public.coste_metro_empresa(empresa_id)
 WHERE coste_metro_snapshot IS NULL;

UPDATE public.pedido_items i
   SET coste_unit_snapshot = CASE
         WHEN lower(COALESCE(i.unidad, 'm')) = 'm' THEN p.coste_metro_snapshot
         ELSE 0
       END
  FROM public.pedidos p
 WHERE p.id = i.pedido_id
   AND i.coste_unit_snapshot IS NULL;
