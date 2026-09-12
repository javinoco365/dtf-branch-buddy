-- ============================================================================
-- CLIENTES · Apodo, aparte del nombre fiscal
-- ============================================================================
--
-- QUÉ HACE
--   Añade clientes.apodo: cómo se llama a un cliente en el día a día, cuando
--   es distinto de su nombre fiscal.
--
-- POR QUÉ
--   `clientes.nombre` tiene que ser el nombre o la razón social tal cual va
--   en la factura -- eso no se toca, y una factura emitida lo congela en su
--   propio snapshot de todas formas. Pero muchos clientes B2B se conocen por
--   otro nombre: "Martí" en vez de "Martí & Hijos S.L.", el nombre de quien
--   hace el pedido en vez de la empresa. Sin un campo aparte, la única forma
--   de anotar eso era escribirlo en Notas, donde no se puede buscar ni se ve
--   en la lista.
--
-- QUÉ NO HACE
--   No sustituye a nombre en ningún sitio que ya lo usa: factura, pedido
--   sincronizado, plantilla de correo. Es un campo nuevo, opcional, que la
--   sincronización de WooCommerce nunca toca -- Woo no tiene concepto de
--   apodo, así que no hay nada que traer ni que pisar.
--
-- REVERSIBLE
--   Sí. Quitar la columna no afecta a ninguna factura, pedido ni al resto de
--   la ficha del cliente.
-- ============================================================================

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS apodo TEXT;

COMMENT ON COLUMN public.clientes.apodo IS
  'Cómo se llama al cliente en el día a día, si es distinto de nombre (el '
  'nombre fiscal). Opcional. La sincronización de WooCommerce nunca lo toca.';
