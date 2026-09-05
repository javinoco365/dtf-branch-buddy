-- ============================================================================
-- PLANTILLAS DE CORREO · Poder maquetar en HTML y CSS
-- ============================================================================
--
-- QUÉ FALTA
--   El cuerpo de una plantilla es texto plano. El HTML lo compone la aplicación
--   metiendo párrafos y ya: no hay forma de poner un logotipo, un botón de
--   seguimiento ni los colores de la tienda.
--
-- CÓMO QUEDA
--   Cada plantilla tiene un formato: 'texto' o 'html'. Se guardan los DOS
--   cuerpos en columnas separadas, no uno solo que cambie de significado. Así
--   se puede volver a texto sin haber perdido la maqueta, y al revés.
--
--   En formato HTML, el cuerpo de texto sigue haciendo falta: un correo bien
--   hecho lleva las dos versiones, y la de texto es lo que ven los clientes de
--   correo que no pintan HTML — y lo que baja la puntuación de spam.
--
-- LO QUE NO CAMBIA, Y ES LO IMPORTANTE
--   Las variables se siguen escapando al sustituirlas. Un cliente que se llame
--   «Martí & Hijos <S.L.>» no puede romper la maqueta, y uno que se llame
--   `<script>` tampoco puede meter nada en el correo de otro. El HTML lo pone
--   quien escribe la plantilla, nunca el dato.
--
-- REVERSIBLE
--   Sí. Añade dos columnas con valor por defecto. Las plantillas que ya existen
--   siguen en 'texto' y se comportan igual que hoy.
-- ============================================================================

ALTER TABLE public.tienda_plantillas_correo
  ADD COLUMN IF NOT EXISTS formato TEXT NOT NULL DEFAULT 'texto',
  ADD COLUMN IF NOT EXISTS cuerpo_html TEXT;

DO $$
BEGIN
  ALTER TABLE public.tienda_plantillas_correo
    ADD CONSTRAINT plantilla_formato_valido CHECK (formato IN ('texto', 'html'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- En formato HTML tiene que haber cuerpo HTML. Sin esto, cambiar el formato y
-- guardar sin escribir nada mandaría un correo vacío.
DO $$
BEGIN
  ALTER TABLE public.tienda_plantillas_correo
    ADD CONSTRAINT plantilla_html_con_cuerpo
    CHECK (formato <> 'html' OR btrim(COALESCE(cuerpo_html, '')) <> '');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.tienda_plantillas_correo.formato IS
  'texto o html. Decide cuál de los dos cuerpos se manda como parte HTML.';
COMMENT ON COLUMN public.tienda_plantillas_correo.cuerpo_html IS
  'La maqueta, con su CSS. El CSS se pasa a estilos en línea al enviar, porque '
  'Outlook y parte de Gmail ignoran los bloques <style>.';
COMMENT ON COLUMN public.tienda_plantillas_correo.cuerpo IS
  'El texto plano. En formato html sigue usándose como versión alternativa: un '
  'correo sin parte de texto puntúa peor en los filtros de spam.';

COMMENT ON TABLE public.tienda_plantillas_correo IS
  'Plantillas de aviso por tienda. El HTML lo escribe quien redacta la '
  'plantilla; las variables se escapan siempre al sustituirlas, para que un '
  'dato del cliente no pueda inyectar etiquetas.';
