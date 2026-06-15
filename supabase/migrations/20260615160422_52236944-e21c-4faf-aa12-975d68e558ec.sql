
ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS iva_default NUMERIC NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS gastos_envio_default NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

CREATE TABLE IF NOT EXISTS public.tienda_seguimiento_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tienda_id UUID NOT NULL UNIQUE REFERENCES public.tiendas(id) ON DELETE CASCADE,
  transportista TEXT,
  tracking_url_template TEXT,
  codigo_cuenta TEXT,
  api_key_ref TEXT,
  activo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tienda_seguimiento_config TO authenticated;
GRANT ALL ON public.tienda_seguimiento_config TO service_role;

ALTER TABLE public.tienda_seguimiento_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seguimiento_member_access" ON public.tienda_seguimiento_config
  FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

CREATE TRIGGER trg_seguimiento_updated_at
  BEFORE UPDATE ON public.tienda_seguimiento_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
