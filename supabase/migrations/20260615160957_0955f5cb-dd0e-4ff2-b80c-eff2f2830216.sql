
-- 1. tiendas.slug
ALTER TABLE public.tiendas ADD COLUMN IF NOT EXISTS slug TEXT;
UPDATE public.tiendas SET slug = lower(regexp_replace(coalesce(nombre,'tienda-'||substr(id::text,1,8)), '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tiendas_slug_unique ON public.tiendas (slug);

-- 2. pedidos extras
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'manual';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS metodo_pago TEXT;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS envio NUMERIC NOT NULL DEFAULT 0;

-- 3. enlaces_seguimiento (placeholder)
CREATE TABLE IF NOT EXISTS public.enlaces_seguimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  transportista TEXT,
  url TEXT,
  codigo_seguimiento TEXT,
  estado TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enlaces_seguimiento TO authenticated;
GRANT ALL ON public.enlaces_seguimiento TO service_role;

ALTER TABLE public.enlaces_seguimiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage seguimiento de su tienda"
  ON public.enlaces_seguimiento
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = enlaces_seguimiento.pedido_id
        AND public.is_tienda_member(auth.uid(), p.tienda_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = enlaces_seguimiento.pedido_id
        AND public.is_tienda_member(auth.uid(), p.tienda_id)
    )
  );

CREATE TRIGGER trg_enlaces_seguimiento_updated_at
  BEFORE UPDATE ON public.enlaces_seguimiento
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_enlaces_seguimiento_pedido ON public.enlaces_seguimiento(pedido_id);
