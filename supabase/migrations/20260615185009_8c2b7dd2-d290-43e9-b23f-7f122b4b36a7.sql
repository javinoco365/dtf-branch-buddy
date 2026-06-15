CREATE TABLE public.empresa_global (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  razon_social TEXT,
  cif TEXT,
  direccion TEXT,
  codigo_postal TEXT,
  ciudad TEXT,
  provincia TEXT,
  pais TEXT DEFAULT 'España',
  email_fiscal TEXT,
  telefono TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT empresa_global_singleton CHECK (id = true)
);

GRANT SELECT ON public.empresa_global TO authenticated;
GRANT ALL ON public.empresa_global TO service_role;

ALTER TABLE public.empresa_global ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa_global select autenticados" ON public.empresa_global
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "empresa_global admin write" ON public.empresa_global
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER empresa_global_touch BEFORE UPDATE ON public.empresa_global
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.empresa_global (id) VALUES (true) ON CONFLICT DO NOTHING;