-- ============================================================================
-- IMÁGENES DE LOS PRESUPUESTOS (tiendas y textil)
-- ============================================================================
--
-- QUÉ RESUELVE
--   Un presupuesto puede llevar imágenes: el diseño que se va a imprimir, la
--   prenda, una maqueta. Se guardan con el presupuesto y salen en el PDF que
--   se manda al cliente. Llegan al crear un presupuesto con IA desde un
--   documento (las imágenes que se suben, y las que se sacan de un PDF) o a
--   mano desde el editor, que también deja quitarlas.
--
-- QUÉ CREA
--   1. public.presupuesto_imagenes: una fila por imagen.
--        presupuesto_id          presupuesto de tienda (presupuestos), o
--        textil_presupuesto_id   presupuesto textil (textil_presupuestos):
--                                exactamente uno de los dos (CHECK).
--        empresa_id              la del presupuesto: la pone un trigger,
--                                llegue la que llegue.
--        ruta                    dónde está el fichero en el bucket
--                                'presupuestos': <empresa>/<ámbito>/<presupuesto>/<id>.<ext>.
--        nombre, tipo_mime, bytes, ancho, alto, orden.
--      Borrado el presupuesto, sus filas se van en cascada (el fichero lo
--      borra la aplicación al borrar el presupuesto).
--   2. El bucket de Storage 'presupuestos', PRIVADO: solo JPG, PNG y WEBP y
--      hasta 5 MB por imagen. Se ven con URL firmada.
--
-- PERMISOS
--   RLS activada, una política por operación (ninguna FOR ALL), con la misma
--   condición que las líneas de cada presupuesto:
--     - de tienda: presupuesto_visible() (quien es de la tienda);
--     - textil: quien es de la empresa del presupuesto (es_miembro_empresa).
--   anon nada; authenticated SELECT, INSERT, UPDATE y DELETE (la RLS decide);
--   service_role, todo.
--   En el bucket: leer, quien ve la fila de la imagen (la RLS de la tabla
--   entra en la subconsulta); subir y borrar, administradores (la aplicación
--   lo hace en el servidor con adminComoUsuario, tras comprobar con la sesión
--   del usuario que ve el presupuesto).
--
-- AUDITORÍA
--   Trigger presupuesto_imagenes_auditoria → auditoria_registrar(). Las filas
--   se escriben con la sesión del usuario: el autor es auth.uid(). No hay nada
--   sensible que enmascarar.
--
-- SIN ESTA MIGRACIÓN
--   Los presupuestos funcionan igual que antes: la aplicación esconde las
--   imágenes (faltaLaTabla) y la IA sigue montando el borrador, sin imágenes.
--
-- NO TOCA NINGUNA FILA EXISTENTE. Se puede aplicar dos veces.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261030100000_presupuesto_imagenes.sql (pídelo
--   antes: borra la tabla, y las imágenes subidas dejan de verse).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.presupuesto_imagenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  presupuesto_id UUID REFERENCES public.presupuestos(id) ON DELETE CASCADE,
  textil_presupuesto_id UUID REFERENCES public.textil_presupuestos(id) ON DELETE CASCADE,
  ruta TEXT NOT NULL,
  nombre TEXT NOT NULL DEFAULT '',
  tipo_mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  ancho INTEGER,
  alto INTEGER,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT presupuesto_imagenes_un_presupuesto
    CHECK (num_nonnulls(presupuesto_id, textil_presupuesto_id) = 1),
  CONSTRAINT presupuesto_imagenes_tipo
    CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT presupuesto_imagenes_bytes
    CHECK (bytes > 0 AND bytes <= 5242880),
  CONSTRAINT presupuesto_imagenes_medidas
    CHECK ((ancho IS NULL OR ancho > 0) AND (alto IS NULL OR alto > 0)),
  CONSTRAINT presupuesto_imagenes_ruta
    CHECK (ruta ~ '^[0-9a-f-]{36}/(tienda|textil)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')
);

CREATE UNIQUE INDEX IF NOT EXISTS presupuesto_imagenes_ruta_unica
  ON public.presupuesto_imagenes (ruta);
CREATE INDEX IF NOT EXISTS presupuesto_imagenes_de_tienda
  ON public.presupuesto_imagenes (presupuesto_id, orden) WHERE presupuesto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS presupuesto_imagenes_de_textil
  ON public.presupuesto_imagenes (textil_presupuesto_id, orden) WHERE textil_presupuesto_id IS NOT NULL;

COMMENT ON TABLE public.presupuesto_imagenes IS
  'Imágenes de un presupuesto (de tienda o textil): salen en su PDF. El fichero, en el bucket privado presupuestos.';
COMMENT ON COLUMN public.presupuesto_imagenes.ruta IS
  'Ruta en el bucket presupuestos: <empresa>/<tienda|textil>/<presupuesto>/<id>.<jpg|png|webp>.';
COMMENT ON COLUMN public.presupuesto_imagenes.empresa_id IS
  'La empresa del presupuesto: la copia un trigger.';

-- ---------------------------------------------------------------------------
-- La empresa es la del presupuesto
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para leer la empresa del presupuesto aunque la RLS no se
-- lo enseñe a quien escribe: si no lo ve, la política de alta lo rechaza igual.
CREATE OR REPLACE FUNCTION public.presupuesto_imagenes_empresa()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
BEGIN
  IF NEW.presupuesto_id IS NOT NULL THEN
    SELECT p.empresa_id INTO v_empresa FROM public.presupuestos p WHERE p.id = NEW.presupuesto_id;
  ELSIF NEW.textil_presupuesto_id IS NOT NULL THEN
    SELECT p.empresa_id INTO v_empresa FROM public.textil_presupuestos p
     WHERE p.id = NEW.textil_presupuesto_id;
  END IF;
  IF v_empresa IS NOT NULL THEN
    NEW.empresa_id := v_empresa;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.presupuesto_imagenes_empresa() IS
  'Trigger: la imagen lleva la empresa de su presupuesto, llegue la que llegue.';

REVOKE EXECUTE ON FUNCTION public.presupuesto_imagenes_empresa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS presupuesto_imagenes_empresa ON public.presupuesto_imagenes;
CREATE TRIGGER presupuesto_imagenes_empresa
  BEFORE INSERT OR UPDATE OF presupuesto_id, textil_presupuesto_id, empresa_id
  ON public.presupuesto_imagenes
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_imagenes_empresa();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.presupuesto_imagenes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presupuesto_imagenes TO authenticated;
GRANT ALL ON public.presupuesto_imagenes TO service_role;

ALTER TABLE public.presupuesto_imagenes ENABLE ROW LEVEL SECURITY;

-- La misma condición en las cuatro: la de las líneas de su presupuesto.
CREATE OR REPLACE FUNCTION public.presupuesto_imagen_visible(
  _presupuesto_id UUID,
  _textil_presupuesto_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _presupuesto_id IS NOT NULL THEN public.presupuesto_visible(_presupuesto_id)
    WHEN _textil_presupuesto_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.textil_presupuestos p
       WHERE p.id = _textil_presupuesto_id
         AND public.es_miembro_empresa(auth.uid(), p.empresa_id))
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.presupuesto_imagen_visible(UUID, UUID) IS
  'Quien ve el presupuesto (de tienda o textil) ve y toca sus imágenes.';

REVOKE EXECUTE ON FUNCTION public.presupuesto_imagen_visible(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presupuesto_imagen_visible(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "presupuesto_imagenes lectura" ON public.presupuesto_imagenes;
CREATE POLICY "presupuesto_imagenes lectura" ON public.presupuesto_imagenes
  FOR SELECT TO authenticated
  USING (public.presupuesto_imagen_visible(presupuesto_id, textil_presupuesto_id));

DROP POLICY IF EXISTS "presupuesto_imagenes alta" ON public.presupuesto_imagenes;
CREATE POLICY "presupuesto_imagenes alta" ON public.presupuesto_imagenes
  FOR INSERT TO authenticated
  WITH CHECK (public.presupuesto_imagen_visible(presupuesto_id, textil_presupuesto_id));

DROP POLICY IF EXISTS "presupuesto_imagenes edicion" ON public.presupuesto_imagenes;
CREATE POLICY "presupuesto_imagenes edicion" ON public.presupuesto_imagenes
  FOR UPDATE TO authenticated
  USING (public.presupuesto_imagen_visible(presupuesto_id, textil_presupuesto_id))
  WITH CHECK (public.presupuesto_imagen_visible(presupuesto_id, textil_presupuesto_id));

DROP POLICY IF EXISTS "presupuesto_imagenes baja" ON public.presupuesto_imagenes;
CREATE POLICY "presupuesto_imagenes baja" ON public.presupuesto_imagenes
  FOR DELETE TO authenticated
  USING (public.presupuesto_imagen_visible(presupuesto_id, textil_presupuesto_id));

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS presupuesto_imagenes_auditoria ON public.presupuesto_imagenes;
CREATE TRIGGER presupuesto_imagenes_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.presupuesto_imagenes
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- El bucket, privado, y sus políticas
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('presupuestos', 'presupuestos', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leer: quien ve la fila de la imagen (la RLS de presupuesto_imagenes se
-- aplica dentro de la subconsulta).
DROP POLICY IF EXISTS "presupuestos_imagenes_lectura" ON storage.objects;
CREATE POLICY "presupuestos_imagenes_lectura"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'presupuestos'
    AND EXISTS (SELECT 1 FROM public.presupuesto_imagenes i WHERE i.ruta = storage.objects.name)
  );

DROP POLICY IF EXISTS "presupuestos_imagenes_alta" ON storage.objects;
CREATE POLICY "presupuestos_imagenes_alta"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'presupuestos' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "presupuestos_imagenes_borrado" ON storage.objects;
CREATE POLICY "presupuestos_imagenes_borrado"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'presupuestos' AND public.has_role(auth.uid(), 'admin'));

-- Que la API vea la tabla nueva sin esperar.
NOTIFY pgrst, 'reload schema';
