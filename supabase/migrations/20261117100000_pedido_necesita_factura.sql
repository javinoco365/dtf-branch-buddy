-- ============================================================================
-- «Quiero factura»: el cliente lo marca en la web y el pedido lo recuerda
-- ============================================================================
-- El checkout de WooCommerce tiene una casilla «Quiero factura» que guarda en
-- el meta_data del pedido la clave `necesita_factura`. La sincronización la lee
-- (src/dominio/sync-woo.ts, pidioFacturaWoo) y la deja aquí.
--
-- Un pedido con la casilla marcada no se despacha con un ticket: el cliente ha
-- pedido factura completa. La pantalla no lo ofrece y los tickets en bloque lo
-- apartan; además la base lo impide al emitir, igual que con el límite del
-- ticket, por si algo se salta la pantalla.
--
-- Reversible: supabase/reversiones/20261117100000_pedido_necesita_factura.sql.

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS necesita_factura BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedidos.necesita_factura IS
  'El cliente marcó «Quiero factura» en la web (meta `necesita_factura`). '
  'Con true, el pedido no admite ticket: solo factura completa.';

-- ---------------------------------------------------------------------------
-- Un ticket no puede ser de un pedido que pidió factura
-- ---------------------------------------------------------------------------
-- Solo al dar de alta el documento: un ticket ya emitido no se toca (una
-- factura emitida no se edita), y si el cliente pide factura después, se
-- canjea el ticket por factura como siempre.
CREATE OR REPLACE FUNCTION public.ticket_no_si_pide_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numero TEXT;
BEGIN
  IF NEW.tipo IS DISTINCT FROM 'simplificada' OR NEW.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.numero INTO v_numero
    FROM public.pedidos p
   WHERE p.id = NEW.pedido_id AND p.necesita_factura;
  IF FOUND THEN
    RAISE EXCEPTION
      'El cliente pidió factura en la web para el pedido %: emite factura completa, no ticket.',
      COALESCE(v_numero, NEW.pedido_id::TEXT);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ticket_no_si_pide_factura() IS
  'Impide dar de alta un ticket (factura simplificada) de un pedido con necesita_factura.';

REVOKE EXECUTE ON FUNCTION public.ticket_no_si_pide_factura() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturas_ticket_no_si_pide_factura ON public.facturas;
CREATE TRIGGER facturas_ticket_no_si_pide_factura
  BEFORE INSERT ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.ticket_no_si_pide_factura();
