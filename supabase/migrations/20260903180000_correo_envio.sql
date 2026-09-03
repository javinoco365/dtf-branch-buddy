-- ============================================================================
-- Envío de avisos por correo
-- ============================================================================
--
-- QUÉ HACE
--   1. Cada tienda guarda su remitente: nombre y dirección.
--   2. Registra qué avisos se han mandado, para no repetirlos.
--
-- POR QUÉ HACE FALTA EL REGISTRO DE ENVÍOS
--   El aviso sale al marcar un pedido como enviado. Pero un estado se puede
--   cambiar y volver a cambiar: marcas enviado, te equivocas, vuelves atrás,
--   marcas enviado otra vez. Sin registro, el cliente recibe tres correos
--   diciéndole que su pedido ha salido.
--
--   Y al revés: si el envío falla —el servidor de correo caído, la dirección
--   mal escrita— eso tiene que quedar anotado. Un aviso que no llega y del que
--   nadie se entera es peor que no tener avisos, porque el cliente cree que se
--   le habría avisado.
--
-- POR QUÉ EL REMITENTE ES DE LA TIENDA Y NO DE LA SOCIEDAD
--   Al revés que la factura. La identidad fiscal es una, pero el correo lo
--   recibe un cliente que compró en una tienda concreta y espera ver esa marca.
--
--   Ojo: el proveedor solo deja enviar desde dominios verificados. Si dos
--   tiendas usan dominios distintos, hay que verificar los dos.
--
-- REVERSIBLE
--   Sí. Añade dos columnas y una tabla. No toca nada existente.
-- ============================================================================

ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS correo_remitente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS correo_remitente_email TEXT;

COMMENT ON COLUMN public.tiendas.correo_remitente_email IS
  'Dirección desde la que salen los avisos de esta tienda. Tiene que estar en '
  'un dominio verificado en el proveedor de correo.';

-- ---------------------------------------------------------------------------
-- Qué se ha mandado y qué no
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pedido_correos_enviados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  clave public.plantilla_correo_clave NOT NULL,
  destinatario TEXT NOT NULL,
  asunto TEXT NOT NULL,
  -- 'enviado' o 'fallido'. Un fallo se guarda igual, con el motivo: si no,
  -- nadie se entera de que el cliente no recibió nada.
  estado TEXT NOT NULL DEFAULT 'enviado',
  error TEXT,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pedido_correos_estado CHECK (estado IN ('enviado', 'fallido'))
);

-- Un aviso enviado por pedido y tipo. Los fallidos no cuentan para el índice:
-- si falló, tiene que poder reintentarse.
CREATE UNIQUE INDEX IF NOT EXISTS pedido_correos_una_vez
  ON public.pedido_correos_enviados (pedido_id, clave)
  WHERE estado = 'enviado';

CREATE INDEX IF NOT EXISTS pedido_correos_por_pedido
  ON public.pedido_correos_enviados (pedido_id, enviado_en DESC);

COMMENT ON TABLE public.pedido_correos_enviados IS
  'Qué avisos han salido y cuáles fallaron. El índice único impide repetir un '
  'aviso ya enviado aunque el estado del pedido vaya y venga.';

GRANT SELECT ON public.pedido_correos_enviados TO authenticated;
GRANT ALL ON public.pedido_correos_enviados TO service_role;

ALTER TABLE public.pedido_correos_enviados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "correos lectura miembros" ON public.pedido_correos_enviados;
CREATE POLICY "correos lectura miembros" ON public.pedido_correos_enviados
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pedidos p
     WHERE p.id = pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)
  ));

-- Escribe solo el servidor, al enviar. Nadie edita este registro a mano: es la
-- prueba de qué se mandó.
