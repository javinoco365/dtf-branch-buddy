-- ============================================================================
-- Logos de tienda y de marca
-- ============================================================================
--
-- QUÉ HACE
--   Crea el bucket 'logos', PÚBLICO, y las políticas para que solo un
--   administrador pueda subir, reemplazar o borrar.
--
-- POR QUÉ PÚBLICO
--   El logo va impreso en la factura y la factura es inmutable. Si el bucket
--   fuera privado habría que firmar una URL, y una URL firmada caduca: al
--   vencer, TODAS las facturas viejas se quedarían sin logo y no se pueden
--   reeditar. Un bucket público da una URL estable para siempre.
--
--   Un logo no es un secreto: es lo que imprimes en cada factura que mandas.
--   Lo que sí importa es que nadie salvo un administrador pueda cambiarlo,
--   y de eso se ocupan las políticas de escritura.
--
-- CONVENCIÓN DE RUTAS
--   tiendas/{tienda_id}...   logo de la tienda, para las facturas de DTF
--   marcas/{marca_id}...     logo de la marca textil
--
-- REVERSIBLE
--   Sí. Crea un bucket y cuatro políticas. No toca datos existentes.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Lectura: el bucket es público, así que Storage sirve los objetos sin pasar
-- por RLS. La política existe igualmente para que leer desde la API con sesión
-- funcione sin sorpresas.
DROP POLICY IF EXISTS "logos_lectura_publica" ON storage.objects;
CREATE POLICY "logos_lectura_publica"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'logos');

-- Escritura: solo administradores.
DROP POLICY IF EXISTS "logos_alta_admin" ON storage.objects;
CREATE POLICY "logos_alta_admin"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'logos' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "logos_reemplazo_admin" ON storage.objects;
CREATE POLICY "logos_reemplazo_admin"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'logos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'logos' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "logos_borrado_admin" ON storage.objects;
CREATE POLICY "logos_borrado_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'logos' AND public.has_role(auth.uid(), 'admin'));
