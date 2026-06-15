
CREATE TYPE public.proyecto_estado AS ENUM ('planificado','en_curso','completado','cancelado');
CREATE TYPE public.proyecto_prioridad AS ENUM ('baja','media','alta');

CREATE TABLE public.proyectos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tienda_id UUID REFERENCES public.tiendas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  cliente_nombre TEXT,
  fecha_prevista DATE,
  estado public.proyecto_estado NOT NULL DEFAULT 'planificado',
  prioridad public.proyecto_prioridad NOT NULL DEFAULT 'media',
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proyectos TO authenticated;
GRANT ALL ON public.proyectos TO service_role;

ALTER TABLE public.proyectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proyectos_member_access" ON public.proyectos
  FOR ALL TO authenticated
  USING (
    tienda_id IS NULL AND public.has_role(auth.uid(), 'admin')
    OR tienda_id IS NOT NULL AND public.is_tienda_member(auth.uid(), tienda_id)
  )
  WITH CHECK (
    tienda_id IS NULL AND public.has_role(auth.uid(), 'admin')
    OR tienda_id IS NOT NULL AND public.is_tienda_member(auth.uid(), tienda_id)
  );

CREATE TRIGGER trg_proyectos_updated_at
  BEFORE UPDATE ON public.proyectos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
