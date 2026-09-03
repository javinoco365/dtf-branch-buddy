-- ============================================================================
-- CONTADORES · Que dos personas a la vez no saquen el mismo número
-- ============================================================================
--
-- EL PROBLEMA
--   nextNumero() en el navegador lee el último número, le suma uno y lo
--   escribe. Entre leer y escribir caben otros: si Javier y Ana guardan un
--   presupuesto en el mismo segundo, los dos leen PRES-2026-0041 y los dos
--   intentan escribir PRES-2026-0042.
--
--   Hoy eso NO duplica el número —la columna es UNIQUE y el segundo guardado
--   revienta— pero revienta con un error de base de datos incomprensible y
--   perdiendo el formulario. El fallo está contenido, no resuelto.
--
--   Y hay un segundo fallo, más silencioso: la secuencia no se reinicia al
--   cambiar de año. En enero de 2027, detrás de PRES-2026-0041 viene
--   PRES-2027-0042.
--
-- LA SOLUCIÓN
--   Un contador por ámbito y ejercicio, y una función que lo incrementa y
--   devuelve el valor nuevo en UNA sola sentencia. El INSERT ... ON CONFLICT
--   DO UPDATE bloquea la fila mientras dura, así que el segundo que llegue
--   espera y se lleva el siguiente número. No hay ventana entre leer y
--   escribir porque no hay dos operaciones.
--
-- ESTO NO ES LA NUMERACIÓN DE FACTURAS, Y NO DEBE USARSE PARA ELLAS
--   Un presupuesto o un pedido pueden tener huecos: si la transacción que
--   cogió el número se deshace, ese número se pierde y no pasa nada. Una
--   factura NO puede tenerlos —artículo 6.1.a del RD 1619/2012— y por eso se
--   numeran con emitir_factura(), que bloquea la fila de la serie durante toda
--   la emisión. Son dos problemas distintos con dos soluciones distintas.
--
-- REVERSIBLE
--   Sí. Una tabla y una función. La siembra deja los contadores donde está hoy
--   la numeración, así que no se repite ningún número existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.contadores (
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- 'textil_presupuesto', 'textil_pedido'… El nombre de lo que se numera.
  ambito TEXT NOT NULL,
  ejercicio INT NOT NULL,
  ultimo INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, ambito, ejercicio),
  CONSTRAINT contador_no_negativo CHECK (ultimo >= 0)
);

COMMENT ON TABLE public.contadores IS
  'Numeración de documentos que NO son facturas: presupuestos y pedidos. '
  'Admite huecos. Las facturas van por emitir_factura(), que no los admite.';

-- ---------------------------------------------------------------------------
-- Coger el siguiente número
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siguiente_numero(
  _empresa_id UUID,
  _ambito TEXT,
  _ejercicio INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ejercicio INT := COALESCE(_ejercicio, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_numero INT;
BEGIN
  -- Una sola sentencia: no hay hueco entre leer y escribir por el que se cuele
  -- otra sesión. El segundo que llegue espera al bloqueo de fila y se lleva el
  -- siguiente.
  INSERT INTO public.contadores AS c (empresa_id, ambito, ejercicio, ultimo)
  VALUES (_empresa_id, _ambito, v_ejercicio, 1)
  ON CONFLICT (empresa_id, ambito, ejercicio)
  DO UPDATE SET ultimo = c.ultimo + 1, updated_at = now()
  RETURNING c.ultimo INTO v_numero;

  RETURN v_numero;
END;
$$;

COMMENT ON FUNCTION public.siguiente_numero(UUID, TEXT, INT) IS
  'Siguiente número correlativo del ámbito y ejercicio, sin carrera posible. '
  'Admite huecos: NO sirve para facturas.';

REVOKE EXECUTE ON FUNCTION public.siguiente_numero(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.siguiente_numero(UUID, TEXT, INT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La referencia completa, en un solo sitio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referencia_documento(
  _prefijo TEXT, _ejercicio INT, _numero INT
)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT _prefijo || '-' || _ejercicio::TEXT || '-' || lpad(_numero::TEXT, 4, '0');
$$;

-- ---------------------------------------------------------------------------
-- Siembra: continuar donde está hoy la numeración
-- ---------------------------------------------------------------------------
-- Sin esto los contadores empezarían en 1 y chocarían con los números que ya
-- existen, que es exactamente lo que se viene a evitar.
DO $$
DECLARE
  v_empresa UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;
  IF v_empresa IS NULL THEN
    RAISE NOTICE 'Sin empresa activa: los contadores se sembrarán al crearla.';
    RETURN;
  END IF;

  -- El número es la última parte de PRES-2026-0041. Se agrupa por el año que
  -- lleva el propio número, no por created_at: es el que manda.
  INSERT INTO public.contadores (empresa_id, ambito, ejercicio, ultimo)
  SELECT v_empresa, 'textil_presupuesto',
         split_part(numero, '-', 2)::INT,
         max(split_part(numero, '-', 3)::INT)
    FROM public.textil_presupuestos
   WHERE numero ~ '^PRES-\d{4}-\d+$'
   GROUP BY split_part(numero, '-', 2)::INT
  ON CONFLICT (empresa_id, ambito, ejercicio)
  DO UPDATE SET ultimo = GREATEST(contadores.ultimo, EXCLUDED.ultimo);

  INSERT INTO public.contadores (empresa_id, ambito, ejercicio, ultimo)
  SELECT v_empresa, 'textil_pedido',
         split_part(numero, '-', 2)::INT,
         max(split_part(numero, '-', 3)::INT)
    FROM public.textil_pedidos
   WHERE numero ~ '^TPD-\d{4}-\d+$'
   GROUP BY split_part(numero, '-', 2)::INT
  ON CONFLICT (empresa_id, ambito, ejercicio)
  DO UPDATE SET ultimo = GREATEST(contadores.ultimo, EXCLUDED.ultimo);
END $$;

-- ---------------------------------------------------------------------------
-- Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.contadores TO authenticated;
GRANT ALL ON public.contadores TO service_role;

-- El REVOKE no es redundante. Supabase concede permisos amplios sobre las
-- tablas nuevas del esquema public a anon y authenticated por privilegios por
-- defecto, así que el GRANT SELECT de arriba no QUITA nada: solo confirma lo
-- que ya había. Esto sí lo quita.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contadores FROM authenticated, anon;

ALTER TABLE public.contadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contadores lectura" ON public.contadores;
CREATE POLICY "contadores lectura" ON public.contadores
  FOR SELECT TO authenticated USING (true);

-- Sin políticas de escritura a propósito, y esa ausencia es la protección de
-- verdad: con RLS activo, una operación sin política se deniega. El contador
-- solo se toca por siguiente_numero(), que es SECURITY DEFINER. Poder
-- escribirlo a mano sería poder repetir un número.

DROP TRIGGER IF EXISTS contadores_auditoria ON public.contadores;
CREATE TRIGGER contadores_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.contadores
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
