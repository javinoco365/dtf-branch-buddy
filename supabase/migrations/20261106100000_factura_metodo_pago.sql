-- ============================================================================
-- Método de pago de cada factura y ticket
-- ============================================================================
-- QUÉ HACE
--   Hasta ahora el PDF de todas las facturas y tickets ponía bajo «Método de
--   pago» el texto de Ajustes > Empresa (empresas.factura_metodo_pago), el de
--   hoy, igual para todas. No había forma de poner otro en una factura
--   concreta (decisión de Javier, 6-11-2026: se revisa y se edita antes de
--   emitir, y lo que se escriba se guarda con el documento).
--
--   1. facturas.metodo_pago y textil_facturas.metodo_pago: el texto elegido
--      al emitir. Vacío: el PDF usa el de Ajustes > Empresa, como hasta ahora
--      (así salen igual todos los documentos emitidos antes de esto).
--   2. Un trigger BEFORE INSERT en las dos tablas lo rellena desde la
--      variable de transacción app.factura_metodo_pago si nadie lo ha puesto.
--      Es la misma forma en que app.usuario_id lleva el autor a la auditoría,
--      y evita reescribir emitir_factura() y emitir_factura_textil(), que
--      numeran con bloqueo y no conviene tocar por un texto.
--   3. emitir_factura_con_pago() y emitir_factura_textil_con_pago(): fijan esa
--      variable (solo para la transacción) y llaman a la función de siempre
--      con los mismos parámetros. Solo service_role; la primera línea exige
--      nivel de escritura, como la función a la que llaman.
--
--   No es un UPDATE de nada emitido: el texto entra en el mismo INSERT que
--   crea el documento, dentro de la misma transacción que le da número.
--
-- REVERSIBLE
--   Sí: DROP FUNCTION de las dos envolturas, DROP TRIGGER de los dos
--   triggers, DROP FUNCTION public.factura_metodo_pago_de_sesion() y
--   ALTER TABLE ... DROP COLUMN metodo_pago en facturas y textil_facturas
--   (se pierde el método elegido en las emitidas desde entonces; sus PDF
--   pasarían a enseñar el de Ajustes > Empresa).
-- ============================================================================

ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS metodo_pago TEXT;
ALTER TABLE public.textil_facturas ADD COLUMN IF NOT EXISTS metodo_pago TEXT;

COMMENT ON COLUMN public.facturas.metodo_pago IS
  'Método de pago elegido al emitir (sale en el PDF). Vacío: el de Ajustes > Empresa.';
COMMENT ON COLUMN public.textil_facturas.metodo_pago IS
  'Método de pago elegido al emitir (sale en el PDF). Vacío: el de Ajustes > Empresa.';

-- ---------------------------------------------------------------------------
-- 2. El trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.factura_metodo_pago_de_sesion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.metodo_pago IS NULL THEN
    NEW.metodo_pago := NULLIF(TRIM(current_setting('app.factura_metodo_pago', true)), '');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.factura_metodo_pago_de_sesion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturas_metodo_pago_de_sesion ON public.facturas;
CREATE TRIGGER facturas_metodo_pago_de_sesion
  BEFORE INSERT ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_metodo_pago_de_sesion();

DROP TRIGGER IF EXISTS textil_facturas_metodo_pago_de_sesion ON public.textil_facturas;
CREATE TRIGGER textil_facturas_metodo_pago_de_sesion
  BEFORE INSERT ON public.textil_facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_metodo_pago_de_sesion();

-- ---------------------------------------------------------------------------
-- 3. Las envolturas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_factura_con_pago(
  _metodo_pago TEXT,
  _usuario_id UUID,
  _tienda_id UUID,
  _receptor JSONB,
  _lineas JSONB,
  _fecha DATE DEFAULT CURRENT_DATE,
  _fecha_vencimiento DATE DEFAULT NULL,
  _cliente_id UUID DEFAULT NULL,
  _pedido_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL,
  _rectifica_a_id UUID DEFAULT NULL,
  _motivo_rectificacion TEXT DEFAULT NULL,
  _simplificada BOOLEAN DEFAULT false,
  _sustituye_a_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  -- true: solo para esta transacción. Al acabar, la variable desaparece.
  PERFORM set_config('app.factura_metodo_pago', COALESCE(TRIM(_metodo_pago), ''), true);
  RETURN public.emitir_factura(
    _usuario_id => _usuario_id,
    _tienda_id => _tienda_id,
    _receptor => _receptor,
    _lineas => _lineas,
    _fecha => _fecha,
    _fecha_vencimiento => _fecha_vencimiento,
    _cliente_id => _cliente_id,
    _pedido_id => _pedido_id,
    _notas => _notas,
    _rectifica_a_id => _rectifica_a_id,
    _motivo_rectificacion => _motivo_rectificacion,
    _simplificada => _simplificada,
    _sustituye_a_id => _sustituye_a_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emitir_factura_con_pago(
  TEXT, UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_factura_con_pago(
  TEXT, UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.emitir_factura_textil_con_pago(
  _metodo_pago TEXT,
  _usuario_id UUID,
  _receptor JSONB,
  _lineas JSONB,
  _marca_id UUID DEFAULT NULL,
  _fecha DATE DEFAULT CURRENT_DATE,
  _vencimiento DATE DEFAULT NULL,
  _cliente_id UUID DEFAULT NULL,
  _presupuesto_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL,
  _rectifica_a_id UUID DEFAULT NULL,
  _motivo_rectificacion TEXT DEFAULT NULL,
  _simplificada BOOLEAN DEFAULT false,
  _sustituye_a_id UUID DEFAULT NULL,
  _textil_pedido_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  PERFORM set_config('app.factura_metodo_pago', COALESCE(TRIM(_metodo_pago), ''), true);
  RETURN public.emitir_factura_textil(
    _usuario_id => _usuario_id,
    _receptor => _receptor,
    _lineas => _lineas,
    _marca_id => _marca_id,
    _fecha => _fecha,
    _vencimiento => _vencimiento,
    _cliente_id => _cliente_id,
    _presupuesto_id => _presupuesto_id,
    _notas => _notas,
    _rectifica_a_id => _rectifica_a_id,
    _motivo_rectificacion => _motivo_rectificacion,
    _simplificada => _simplificada,
    _sustituye_a_id => _sustituye_a_id,
    _textil_pedido_id => _textil_pedido_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emitir_factura_textil_con_pago(
  TEXT, UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_factura_textil_con_pago(
  TEXT, UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
