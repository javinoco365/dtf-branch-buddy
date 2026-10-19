-- ============================================================================
-- PEDIDOS: CUÁNDO SE REALIZÓ DE VERDAD, COSTE REAL DEL ENVÍO Y AJUSTES DEL
-- RESUMEN
-- ============================================================================
--
-- QUÉ RESUELVE
--   1. Un pedido que entra tarde se imprime al día siguiente. Para saber los
--      metros tirados cada día hace falta el día en que se realizó, no el día
--      en que se pidió. Hasta ahora solo había un estado que se sobrescribe.
--   2. Se suponía que la agencia cobra por cada envío lo mismo que se le cobra
--      al cliente. No es así: cobra hasta 5,00 € y no siempre lo mismo. Sin el
--      coste real, el margen «con envíos» y «sin envíos» salían iguales.
--   3. El Resumen de Gerencia necesita la hora de corte, la capacidad de la
--      máquina y la jornada.
--
-- QUÉ CAMBIA
--   pedidos y textil_pedidos:
--     - realizado_en: cuándo se realizó. Lo pone solo el trigger la primera
--       vez que el pedido pasa a 'enviado' (o a 'entregado', que es como llega
--       un «completado» de WooCommerce). En los de WooCommerce, la
--       sincronización trae la fecha de completado de la web.
--     - realizado_manual: si una persona corrigió la fecha. Entonces nada la
--       pisa: ni la sincronización ni el trigger. Solo se corrige con
--       pedido_fijar_realizado(), que deja el autor en la auditoría.
--     - coste_envio_real: lo que cobró la agencia por ese envío, sin IVA.
--       Nulo: se estima con gerencia_ajustes.coste_envio_defecto.
--   Si el pedido vuelve atrás (a pendiente, en producción, imprimiendo o
--   listo), se borra realizado_en: no está hecho. Si se cancela después de
--   realizarse, se conserva: lo impreso, impreso está.
--
--   gerencia_ajustes: hora_corte (13:30), metros_hora (70), jornada_inicio y
--   jornada_fin (09:00–13:00) y coste_envio_defecto (5,00 €).
--
-- HISTÓRICO
--   Los pedidos ya enviados o entregados toman la fecha de la auditoría: el
--   momento en que pasaron a ese estado. Los que no salen en la auditoría (los
--   anteriores a ella) se quedan sin fecha: no se inventa. Los de WooCommerce
--   se pueden recuperar de la web desde el Resumen («Recuperar fechas»).
--
-- REVERSIBLE
--   Sí. Quitar los triggers y la función, y las columnas nuevas:
--     DROP TRIGGER pedidos_realizado ON public.pedidos;
--     DROP TRIGGER textil_pedidos_realizado ON public.textil_pedidos;
--     DROP FUNCTION public.pedido_realizado_trg(), public.pedido_fijar_realizado(TEXT, UUID, TIMESTAMPTZ, UUID);
--     ALTER TABLE public.pedidos DROP COLUMN realizado_en, DROP COLUMN realizado_manual, DROP COLUMN coste_envio_real;
--     (lo mismo en textil_pedidos y las cinco columnas de gerencia_ajustes)
--   No toca importes, estados ni documentos fiscales.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS realizado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS realizado_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coste_envio_real NUMERIC(12,2);

ALTER TABLE public.textil_pedidos
  ADD COLUMN IF NOT EXISTS realizado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS realizado_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coste_envio_real NUMERIC(12,2);

DO $$ BEGIN
  ALTER TABLE public.pedidos ADD CONSTRAINT pedido_coste_envio_real_valido
    CHECK (coste_envio_real IS NULL OR (coste_envio_real >= 0 AND coste_envio_real <= 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.textil_pedidos ADD CONSTRAINT textil_pedido_coste_envio_real_valido
    CHECK (coste_envio_real IS NULL OR (coste_envio_real >= 0 AND coste_envio_real <= 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.pedidos.realizado_en IS
  'Cuándo se realizó el pedido: la primera vez que pasó a enviado o entregado, o la '
  'fecha de completado de WooCommerce. Corregible con pedido_fijar_realizado().';
COMMENT ON COLUMN public.pedidos.realizado_manual IS
  'La fecha de realizado la corrigió una persona: ni la sincronización ni el trigger la pisan.';
COMMENT ON COLUMN public.pedidos.coste_envio_real IS
  'Lo que cobró la agencia por el envío, sin IVA. Nulo: se estima con gerencia_ajustes.coste_envio_defecto.';
COMMENT ON COLUMN public.textil_pedidos.realizado_en IS
  'Cuándo se realizó el pedido: la primera vez que pasó a enviado o entregado.';
COMMENT ON COLUMN public.textil_pedidos.realizado_manual IS
  'La fecha de realizado la corrigió una persona: el trigger no la pisa.';
COMMENT ON COLUMN public.textil_pedidos.coste_envio_real IS
  'Lo que cobró la agencia por el envío, sin IVA. Nulo: se estima con gerencia_ajustes.coste_envio_defecto.';

CREATE INDEX IF NOT EXISTS pedidos_realizado_en_idx
  ON public.pedidos (realizado_en) WHERE realizado_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_pedidos_realizado_en_idx
  ON public.textil_pedidos (realizado_en) WHERE realizado_en IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. El trigger: pone, conserva o borra realizado_en según el estado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedido_realizado_trg()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_hecho_ahora BOOLEAN := NEW.estado::TEXT IN ('enviado', 'entregado');
  v_hecho_antes BOOLEAN := TG_OP = 'UPDATE' AND OLD.estado::TEXT IN ('enviado', 'entregado');
  v_corrigiendo BOOLEAN := coalesce(current_setting('app.realizado_manual', true), '') = 'on';
BEGIN
  -- Una fecha corregida a mano solo la cambia otra corrección a mano.
  IF TG_OP = 'UPDATE' AND OLD.realizado_manual AND NOT v_corrigiendo THEN
    NEW.realizado_en := OLD.realizado_en;
    NEW.realizado_manual := true;
  END IF;
  IF NOT v_corrigiendo AND TG_OP = 'UPDATE' THEN
    NEW.realizado_manual := OLD.realizado_manual;
  END IF;

  -- Vuelve a producción: no está hecho.
  IF TG_OP = 'UPDATE' AND v_hecho_antes
     AND NEW.estado::TEXT IN ('pendiente', 'en_produccion', 'imprimiendo', 'listo') THEN
    NEW.realizado_en := NULL;
    NEW.realizado_manual := false;
    RETURN NEW;
  END IF;

  -- Un vacío que llega de fuera (la sincronización, sin fecha de completado)
  -- no borra la fecha de un pedido que sigue hecho, o que se canceló después.
  IF TG_OP = 'UPDATE' AND NEW.realizado_en IS NULL AND OLD.realizado_en IS NOT NULL
     AND (v_hecho_ahora OR NEW.estado::TEXT = 'cancelado') THEN
    NEW.realizado_en := OLD.realizado_en;
  END IF;

  -- Pasa a hecho por primera vez y nadie trae la fecha: ahora.
  IF v_hecho_ahora AND NEW.realizado_en IS NULL THEN
    IF TG_OP = 'UPDATE' AND NOT v_hecho_antes THEN
      NEW.realizado_en := now();
    ELSIF TG_OP = 'INSERT' THEN
      -- Un pedido de WooCommerce que llega ya completado sin fecha de la web
      -- es histórico: ponerle «ahora» sería inventar. Se queda sin fecha.
      IF TG_TABLE_NAME <> 'pedidos' OR coalesce(NEW.origen, 'manual') <> 'woocommerce' THEN
        NEW.realizado_en := now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_realizado ON public.pedidos;
CREATE TRIGGER pedidos_realizado
  BEFORE INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_realizado_trg();

-- textil_pedidos no tiene `origen`: el trigger no lo lee en esa tabla, pero
-- PL/pgSQL compila la referencia por tabla, así que va en una función aparte.
CREATE OR REPLACE FUNCTION public.textil_pedido_realizado_trg()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_hecho_ahora BOOLEAN := NEW.estado IN ('enviado', 'entregado');
  v_hecho_antes BOOLEAN := TG_OP = 'UPDATE' AND OLD.estado IN ('enviado', 'entregado');
  v_corrigiendo BOOLEAN := coalesce(current_setting('app.realizado_manual', true), '') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.realizado_manual AND NOT v_corrigiendo THEN
    NEW.realizado_en := OLD.realizado_en;
    NEW.realizado_manual := true;
  END IF;
  IF NOT v_corrigiendo AND TG_OP = 'UPDATE' THEN
    NEW.realizado_manual := OLD.realizado_manual;
  END IF;
  IF TG_OP = 'UPDATE' AND v_hecho_antes
     AND NEW.estado IN ('pendiente', 'en_produccion', 'imprimiendo', 'listo') THEN
    NEW.realizado_en := NULL;
    NEW.realizado_manual := false;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.realizado_en IS NULL AND OLD.realizado_en IS NOT NULL
     AND (v_hecho_ahora OR NEW.estado = 'cancelado') THEN
    NEW.realizado_en := OLD.realizado_en;
  END IF;
  IF v_hecho_ahora AND NEW.realizado_en IS NULL
     AND (TG_OP = 'INSERT' OR NOT v_hecho_antes) THEN
    NEW.realizado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

-- La de pedidos lee NEW.origen: en textil_pedidos va la suya.
DROP TRIGGER IF EXISTS textil_pedidos_realizado ON public.textil_pedidos;
CREATE TRIGGER textil_pedidos_realizado
  BEFORE INSERT OR UPDATE ON public.textil_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.textil_pedido_realizado_trg();

-- ---------------------------------------------------------------------------
-- 3. Corregir la fecha a mano, con autor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedido_fijar_realizado(
  _tabla TEXT,
  _id UUID,
  _realizado TIMESTAMPTZ,
  _usuario_id UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_estado TEXT;
  v_desde TIMESTAMPTZ;
BEGIN
  IF _tabla NOT IN ('pedidos', 'textil_pedidos') THEN
    RAISE EXCEPTION 'Tabla no válida: %', _tabla USING ERRCODE = '22023';
  END IF;
  IF _realizado IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de realizado' USING ERRCODE = '22023';
  END IF;
  IF _realizado > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'La fecha de realizado no puede ser futura' USING ERRCODE = '22023';
  END IF;

  IF _tabla = 'pedidos' THEN
    SELECT estado::TEXT, fecha_pedido INTO v_estado, v_desde
      FROM public.pedidos WHERE id = _id FOR UPDATE;
  ELSE
    SELECT estado, fecha::TIMESTAMPTZ INTO v_estado, v_desde
      FROM public.textil_pedidos WHERE id = _id FOR UPDATE;
  END IF;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_estado NOT IN ('enviado', 'entregado', 'cancelado') THEN
    RAISE EXCEPTION 'Solo se corrige la fecha de un pedido enviado o entregado'
      USING ERRCODE = '22023';
  END IF;
  -- Un día de margen: la hora de los pedidos web se guarda sin zona.
  IF _realizado < v_desde - interval '1 day' THEN
    RAISE EXCEPTION 'La fecha de realizado no puede ser anterior al pedido' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.usuario_id', coalesce(_usuario_id::TEXT, ''), true);
  PERFORM set_config('app.realizado_manual', 'on', true);
  IF _tabla = 'pedidos' THEN
    UPDATE public.pedidos SET realizado_en = _realizado, realizado_manual = true WHERE id = _id;
  ELSE
    UPDATE public.textil_pedidos SET realizado_en = _realizado, realizado_manual = true WHERE id = _id;
  END IF;
  PERFORM set_config('app.realizado_manual', '', true);
  RETURN _realizado;
END;
$$;

REVOKE ALL ON FUNCTION public.pedido_fijar_realizado(TEXT, UUID, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pedido_fijar_realizado(TEXT, UUID, TIMESTAMPTZ, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_fijar_realizado(TEXT, UUID, TIMESTAMPTZ, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Ajustes del Resumen
-- ---------------------------------------------------------------------------
ALTER TABLE public.gerencia_ajustes
  ADD COLUMN IF NOT EXISTS hora_corte TIME NOT NULL DEFAULT '13:30',
  ADD COLUMN IF NOT EXISTS metros_hora NUMERIC(8,2) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS jornada_inicio TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS jornada_fin TIME NOT NULL DEFAULT '13:00',
  ADD COLUMN IF NOT EXISTS coste_envio_defecto NUMERIC(12,2) NOT NULL DEFAULT 5.00;

DO $$ BEGIN
  ALTER TABLE public.gerencia_ajustes ADD CONSTRAINT gerencia_ajustes_resumen_validos CHECK (
    metros_hora > 0 AND jornada_fin > jornada_inicio
    AND coste_envio_defecto >= 0 AND coste_envio_defecto <= 1000
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.gerencia_ajustes.hora_corte IS
  'Un pedido que entra después de esta hora se hace al día siguiente: sale como «fuera de hora».';
COMMENT ON COLUMN public.gerencia_ajustes.metros_hora IS
  'Metros que tira la máquina en una hora. Capacidad = metros_hora × horas de jornada × días laborables.';
COMMENT ON COLUMN public.gerencia_ajustes.coste_envio_defecto IS
  'Lo que se estima que cobra la agencia por envío, sin IVA, si el pedido no tiene coste_envio_real.';

-- ---------------------------------------------------------------------------
-- 5. Histórico: la fecha en que la auditoría vio pasar el pedido a hecho
-- ---------------------------------------------------------------------------
WITH paso AS (
  SELECT a.registro_id, min(a.created_at) AS cuando
    FROM public.auditoria a
   WHERE a.tabla = 'pedidos'
     AND a.datos_despues ->> 'estado' IN ('enviado', 'entregado')
     AND (a.operacion = 'INSERT' OR coalesce(a.datos_antes ->> 'estado', '') NOT IN ('enviado', 'entregado'))
   GROUP BY a.registro_id
)
UPDATE public.pedidos p
   SET realizado_en = paso.cuando
  FROM paso
 WHERE paso.registro_id = p.id::TEXT
   AND p.realizado_en IS NULL
   AND p.estado::TEXT IN ('enviado', 'entregado');

WITH paso AS (
  SELECT a.registro_id, min(a.created_at) AS cuando
    FROM public.auditoria a
   WHERE a.tabla = 'textil_pedidos'
     AND a.datos_despues ->> 'estado' IN ('enviado', 'entregado')
     AND (a.operacion = 'INSERT' OR coalesce(a.datos_antes ->> 'estado', '') NOT IN ('enviado', 'entregado'))
   GROUP BY a.registro_id
)
UPDATE public.textil_pedidos p
   SET realizado_en = paso.cuando
  FROM paso
 WHERE paso.registro_id = p.id::TEXT
   AND p.realizado_en IS NULL
   AND p.estado IN ('enviado', 'entregado');
