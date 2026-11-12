-- ============================================================================
-- Quién usa cada cuenta: los socios de cada cuenta de acceso
-- ============================================================================
--
-- EL PROBLEMA
--   Una cuenta de acceso no es una persona. La cuenta de gerencia la usan
--   varios socios (Javier Novoa, Miguel Novoa, Álvaro Romero) y la de Javier
--   Cárdenas, solo él. La Agenda necesita saber quién está delante para
--   enseñar «mis tareas» y apuntar quién crea cada una, y la base solo conoce
--   la cuenta (auth.uid()).
--
-- QUÉ HACE
--   Crea public.socio_cuentas: qué socio (caja_socios, la misma lista que usan
--   Caja e Inversión) entra con qué cuenta (auth.users).
--     - Un socio entra con UNA cuenta como mucho (UNIQUE socio_id).
--     - Una cuenta puede tener varios socios: entonces, al entrar, el CRM
--       pregunta «¿Quién eres?». Con un solo socio, entra ya identificado.
--       Sin ninguno, el CRM funciona como hasta ahora.
--     - La empresa de la fila es la del socio: la copia un trigger.
--   Y la función socio_cuentas_fijar(_usuario_id, _cuenta, _socios), que deja
--   una cuenta con exactamente esos socios en una sola transacción. Un socio
--   que estaba en otra cuenta pasa a esta (un socio, una cuenta).
--
--   El nombre que se elige al entrar NO es una contraseña: sirve para saber de
--   quién es cada tarea, no para limitar lo que se ve. Quien usa la cuenta de
--   gerencia puede elegir cualquiera de sus socios.
--
-- PERMISOS
--   RLS activada, una política por operación (ninguna FOR ALL):
--     - Leer: quien ve la empresa (es_miembro_empresa), y cada cuenta sus
--       propias filas (la pantalla «¿Quién eres?» las necesita).
--     - Dar de alta, cambiar y borrar: solo administradores activos
--       (has_role 'admin') de su empresa, con el nivel al final como toda
--       política de escritura. Es gestión de accesos, como Ajustes > Usuarios.
--   Guardia rol_guardia('admin') para los caminos sin RLS, y la función
--   empieza con rol_exigir_quien(_usuario_id, 'admin').
--   Borrar una fila no borra datos de negocio: quita a un socio de una cuenta.
--
-- AUDITORÍA
--   Trigger socio_cuentas_auditoria → auditoria_registrar(). La función fija
--   app.usuario_id con _usuario_id: el cambio queda con el nombre del admin.
--   No hay nada sensible que enmascarar.
--
-- SIN ESTA MIGRACIÓN
--   El CRM no pregunta «¿Quién eres?» a nadie y Ajustes > Usuarios avisa de que
--   falta para guardar quién usa cada cuenta.
--
-- NO TOCA NINGUNA FILA EXISTENTE y no da de alta ninguna: qué socios usan cada
-- cuenta se elige en Ajustes > Usuarios. Se puede aplicar dos veces.
--
-- REVERSIBLE: sí, con supabase/reversiones/20261115100000_socio_cuentas.sql
-- (son DROP: se pierde qué socio usa cada cuenta, nada más).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.socio_cuentas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  -- RESTRICT: un socio no se borra (se desactiva), y si alguna vez se hiciera,
  -- que no se lleve por delante en silencio a quién usaba cada cuenta.
  socio_id UUID NOT NULL REFERENCES public.caja_socios(id) ON DELETE RESTRICT,
  -- CASCADE: si la cuenta desaparece de Auth, no queda nadie que la use.
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT socio_cuentas_un_socio_una_cuenta UNIQUE (socio_id)
);

CREATE INDEX IF NOT EXISTS socio_cuentas_usuario ON public.socio_cuentas (usuario_id);

COMMENT ON TABLE public.socio_cuentas IS
  'Qué socio entra con qué cuenta de acceso. Una cuenta con varios socios pregunta «¿Quién eres?» al entrar. '
  'Se gestiona en Ajustes > Usuarios (solo admin). No es una contraseña: no limita lo que se ve.';
COMMENT ON COLUMN public.socio_cuentas.socio_id IS
  'El socio (caja_socios). Un socio entra con una cuenta como mucho.';
COMMENT ON COLUMN public.socio_cuentas.usuario_id IS
  'La cuenta de acceso (auth.users) con la que entra.';

-- ---------------------------------------------------------------------------
-- La empresa de la fila es la del socio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.socio_cuentas_empresa_del_socio()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
BEGIN
  SELECT s.empresa_id INTO v_empresa FROM public.caja_socios s WHERE s.id = NEW.socio_id;
  IF v_empresa IS NOT NULL THEN
    NEW.empresa_id := v_empresa;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.socio_cuentas_empresa_del_socio() IS
  'Trigger: la fila lleva la empresa de su socio, llegue la que llegue.';

REVOKE EXECUTE ON FUNCTION public.socio_cuentas_empresa_del_socio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS socio_cuentas_empresa ON public.socio_cuentas;
CREATE TRIGGER socio_cuentas_empresa
  BEFORE INSERT OR UPDATE OF socio_id, empresa_id ON public.socio_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.socio_cuentas_empresa_del_socio();

DROP TRIGGER IF EXISTS socio_cuentas_touch ON public.socio_cuentas;
CREATE TRIGGER socio_cuentas_touch
  BEFORE UPDATE ON public.socio_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.socio_cuentas FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.socio_cuentas TO authenticated;
GRANT ALL ON public.socio_cuentas TO service_role;

ALTER TABLE public.socio_cuentas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "socio cuentas lectura" ON public.socio_cuentas;
CREATE POLICY "socio cuentas lectura" ON public.socio_cuentas
  FOR SELECT TO authenticated
  USING (
    usuario_id = (SELECT auth.uid())
    OR public.es_miembro_empresa((SELECT auth.uid()), empresa_id)
  );

-- Escribir: admin de la empresa. El nivel va al final, como en todas las
-- políticas de escritura (20261031200200): rol_puede_escribir en el alta y la
-- edición, rol_puede_borrar en la baja. has_role() ya no cuenta a un admin
-- desactivado (20261031300200).
DROP POLICY IF EXISTS "socio cuentas alta admin" ON public.socio_cuentas;
CREATE POLICY "socio cuentas alta admin" ON public.socio_cuentas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  );

DROP POLICY IF EXISTS "socio cuentas edicion admin" ON public.socio_cuentas;
CREATE POLICY "socio cuentas edicion admin" ON public.socio_cuentas
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_escribir(auth.uid()))
  );

DROP POLICY IF EXISTS "socio cuentas baja admin" ON public.socio_cuentas;
CREATE POLICY "socio cuentas baja admin" ON public.socio_cuentas
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND public.es_miembro_empresa(auth.uid(), empresa_id)
    AND (SELECT public.rol_puede_borrar(auth.uid()))
  );

-- La guardia, para los caminos que se saltan la RLS (SECURITY DEFINER y
-- clave de servicio): las tres operaciones son de admin.
DROP TRIGGER IF EXISTS rol_guardia ON public.socio_cuentas;
CREATE TRIGGER rol_guardia
  BEFORE INSERT OR UPDATE OR DELETE ON public.socio_cuentas
  FOR EACH STATEMENT EXECUTE FUNCTION public.rol_guardia('admin');

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS socio_cuentas_auditoria ON public.socio_cuentas;
CREATE TRIGGER socio_cuentas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.socio_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- socio_cuentas_fijar(): deja una cuenta con exactamente estos socios
-- ---------------------------------------------------------------------------
-- Todo o nada: quita los socios que ya no están, añade los nuevos y trae a
-- esta cuenta los que estaban en otra. Devuelve los socios con que queda.
CREATE OR REPLACE FUNCTION public.socio_cuentas_fijar(
  _usuario_id UUID,
  _cuenta UUID,
  _socios UUID[]
)
RETURNS SETOF UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_socios UUID[] := COALESCE(_socios, ARRAY[]::UUID[]);
  v_desconocido UUID;
BEGIN
  PERFORM public.rol_exigir_quien(_usuario_id, 'admin');
  -- Desde el navegador, el autor es quien llama: no vale firmar con otro.
  IF auth.uid() IS NOT NULL AND _usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El autor del cambio tiene que ser quien lo hace'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.usuario_id', COALESCE(_usuario_id::TEXT, ''), true);

  IF _cuenta IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _cuenta) THEN
    RAISE EXCEPTION 'Esa cuenta de acceso no existe' USING ERRCODE = '22023';
  END IF;

  SELECT x INTO v_desconocido
    FROM unnest(v_socios) AS x
   WHERE NOT EXISTS (SELECT 1 FROM public.caja_socios s WHERE s.id = x)
   LIMIT 1;
  IF v_desconocido IS NOT NULL THEN
    RAISE EXCEPTION 'El socio % no existe', v_desconocido USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.socio_cuentas
   WHERE usuario_id = _cuenta
     AND socio_id <> ALL (v_socios);

  INSERT INTO public.socio_cuentas (socio_id, usuario_id)
  SELECT DISTINCT x, _cuenta FROM unnest(v_socios) AS x
  ON CONFLICT (socio_id) DO UPDATE
    SET usuario_id = EXCLUDED.usuario_id
  WHERE public.socio_cuentas.usuario_id IS DISTINCT FROM EXCLUDED.usuario_id;

  RETURN QUERY
    SELECT sc.socio_id FROM public.socio_cuentas sc WHERE sc.usuario_id = _cuenta;
END;
$$;

COMMENT ON FUNCTION public.socio_cuentas_fijar(UUID, UUID, UUID[]) IS
  'Deja la cuenta _cuenta con exactamente los socios _socios (un socio que estaba en otra cuenta pasa a esta). Solo admin.';

REVOKE EXECUTE ON FUNCTION public.socio_cuentas_fijar(UUID, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.socio_cuentas_fijar(UUID, UUID, UUID[]) TO authenticated, service_role;

-- Que la API vea la tabla y la función nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
