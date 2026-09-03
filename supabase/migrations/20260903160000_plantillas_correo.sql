-- ============================================================================
-- Plantillas de correo por tienda
-- ============================================================================
--
-- QUÉ HACE
--   Una plantilla por tienda y tipo de aviso, editable desde Ajustes. De
--   momento solo hay un tipo, 'pedido_enviado', que es el que se manda al
--   marcar un pedido como enviado.
--
-- POR QUÉ EL CUERPO ES TEXTO Y NO HTML
--   Se guarda texto plano con saltos de línea, y el correo HTML se compone
--   escapando ese texto y convirtiendo los saltos en <br>. Así:
--
--     - No hace falta un editor de HTML ni validar marcado.
--     - Es imposible que una plantilla mal cerrada rompa el correo.
--     - El nombre de un cliente con & o < no puede colarse como etiqueta:
--       lo escapa el renderizador (ver src/dominio/plantillas.ts).
--
--   Un aviso de "tu pedido ha salido" no necesita maquetación; necesita llegar
--   y leerse. Si algún día hace falta HTML de verdad, se añade una columna.
--
-- VARIABLES
--   Entre llaves dobles: {{cliente_nombre}}, {{pedido_numero}}, {{total}},
--   {{tienda_nombre}}, {{transportista}}, {{codigo_seguimiento}},
--   {{seguimiento_url}}. La lista viva está en src/lib/plantillas-correo.ts.
--
-- LO QUE ESTA MIGRACIÓN NO HACE
--   No envía nada. El envío necesita un proveedor de correo contratado y un
--   dominio verificado, y va aparte.
--
-- REVERSIBLE
--   Sí. Crea una tabla y un tipo. No toca nada existente.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.plantilla_correo_clave AS ENUM ('pedido_enviado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.tienda_plantillas_correo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  clave public.plantilla_correo_clave NOT NULL,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  -- Desactivada, la plantilla se conserva pero no se manda nada. Sirve para
  -- cortar los avisos sin perder el texto que costó escribir.
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tienda_id, clave)
);

COMMENT ON TABLE public.tienda_plantillas_correo IS
  'Plantillas de aviso por tienda. El cuerpo es texto plano: el HTML se compone '
  'escapándolo, para que una variable no pueda inyectar etiquetas.';
COMMENT ON COLUMN public.tienda_plantillas_correo.activa IS
  'A false no se envía, pero el texto se conserva.';

DROP TRIGGER IF EXISTS tienda_plantillas_correo_touch ON public.tienda_plantillas_correo;
CREATE TRIGGER tienda_plantillas_correo_touch
  BEFORE UPDATE ON public.tienda_plantillas_correo
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.tienda_plantillas_correo TO authenticated;
GRANT ALL ON public.tienda_plantillas_correo TO service_role;

ALTER TABLE public.tienda_plantillas_correo ENABLE ROW LEVEL SECURITY;

-- Por operación y nunca FOR ALL: un FOR ALL en una tabla de negocio es lo que
-- permite borrarla entera desde el navegador.
DROP POLICY IF EXISTS "plantillas lectura miembros" ON public.tienda_plantillas_correo;
CREATE POLICY "plantillas lectura miembros" ON public.tienda_plantillas_correo
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "plantillas alta admin" ON public.tienda_plantillas_correo;
CREATE POLICY "plantillas alta admin" ON public.tienda_plantillas_correo
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "plantillas edicion admin" ON public.tienda_plantillas_correo;
CREATE POLICY "plantillas edicion admin" ON public.tienda_plantillas_correo
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Sin política de DELETE a propósito: una plantilla se desactiva, no se borra.

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
-- Cambiar el texto de un correo que sale a nombre de la empresa es de las cosas
-- que interesa saber quién hizo.
DROP TRIGGER IF EXISTS tienda_plantillas_correo_auditoria ON public.tienda_plantillas_correo;
CREATE TRIGGER tienda_plantillas_correo_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.tienda_plantillas_correo
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- Una plantilla de partida para cada tienda
-- ---------------------------------------------------------------------------
-- El texto por defecto vive en una función, no repetido en dos sitios: lo usan
-- la siembra de las tiendas que ya existen y el trigger de las que se creen
-- después. Sin el trigger, una tienda nueva nacería muda y no se notaría hasta
-- que un cliente no recibiera su aviso.
CREATE OR REPLACE FUNCTION public.plantillas_correo_sembrar(_tienda_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tienda_plantillas_correo (empresa_id, tienda_id, clave, asunto, cuerpo)
  SELECT
    t.empresa_id,
    t.id,
    'pedido_enviado',
    'Tu pedido {{pedido_numero}} ya está en camino',
    E'Hola {{cliente_nombre}}:\n\nTu pedido {{pedido_numero}} ha salido de nuestras instalaciones.\n\nTransportista: {{transportista}}\nNúmero de seguimiento: {{codigo_seguimiento}}\nPuedes seguirlo aquí: {{seguimiento_url}}\n\nGracias por confiar en nosotros.\n\n{{tienda_nombre}}'
  FROM public.tiendas t
  WHERE t.id = _tienda_id AND t.empresa_id IS NOT NULL
  ON CONFLICT (tienda_id, clave) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.plantillas_correo_sembrar(UUID) IS
  'Crea las plantillas que le faltan a una tienda. Idempotente: nunca pisa un '
  'texto ya escrito.';

REVOKE EXECUTE ON FUNCTION public.plantillas_correo_sembrar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plantillas_correo_sembrar(UUID) TO authenticated, service_role;

-- Toda tienda nueva nace con sus plantillas.
CREATE OR REPLACE FUNCTION public.tiendas_sembrar_plantillas()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.plantillas_correo_sembrar(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tiendas_plantillas_correo ON public.tiendas;
CREATE TRIGGER tiendas_plantillas_correo
  AFTER INSERT ON public.tiendas
  FOR EACH ROW EXECUTE FUNCTION public.tiendas_sembrar_plantillas();

-- Y las que ya existen, ahora.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.tiendas WHERE empresa_id IS NOT NULL LOOP
    PERFORM public.plantillas_correo_sembrar(r.id);
  END LOOP;
END $$;
