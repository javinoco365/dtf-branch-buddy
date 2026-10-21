/**
 * Medidor de rendimiento oculto (fase 0 del plan de rendimiento,
 * docs/rendimiento/plan.md).
 *
 * Solo se activa con `?medir=1` en la dirección; se recuerda en
 * `sessionStorage` para que siga activo al navegar dentro de la aplicación, y
 * `?medir=0` lo apaga. No guarda nada en el servidor ni en la base de datos:
 * todo vive en la memoria de la pestaña y se copia a mano con «Copiar».
 *
 * No depende de React ni del dominio: el componente `MedidorRendimiento`
 * conecta el router y React Query con estas funciones.
 */

const CLAVE = "crm-medir";

/** ¿Está pedida la medición en esta pestaña? Nunca lanza. */
export function medicionActiva(): boolean {
  if (typeof window === "undefined") return false;
  let pedido: string | null = null;
  try {
    pedido = new URLSearchParams(window.location.search).get("medir");
  } catch {
    pedido = null;
  }
  try {
    if (pedido === "1") sessionStorage.setItem(CLAVE, "1");
    if (pedido === "0") sessionStorage.removeItem(CLAVE);
    return sessionStorage.getItem(CLAVE) === "1";
  } catch {
    // Sin sessionStorage (navegación privada, datos bloqueados): solo cuenta
    // la dirección actual.
    return pedido === "1";
  }
}

export type MedidaConsulta = { peticiones: number; ms: number; filas: number; errores: number };

export type MedidaPantalla = {
  ruta: string;
  /** ms desde el clic hasta que el router da la ruta por resuelta. */
  msResuelta: number | null;
  /** ms desde el clic hasta el primer fotograma sin consultas en marcha. */
  msLista: number | null;
  consultas: Record<string, MedidaConsulta>;
  red: {
    peticiones: number;
    kb: number;
    supabase: number;
    serverFn: number;
    authUser: number;
  };
};

type Pantalla = MedidaPantalla & { inicio: number; iniciosConsulta: Map<string, number> };

/** Cuántas filas trae una respuesta: listas, o la suma de las listas de un objeto. */
export function contarFilas(datos: unknown): number {
  if (Array.isArray(datos)) return datos.length;
  if (datos && typeof datos === "object") {
    let n = 0;
    for (const v of Object.values(datos)) if (Array.isArray(v)) n += v.length;
    return n;
  }
  return 0;
}

const redondear = (n: number) => Math.round(n * 10) / 10;

// `globalThis.performance` y no `performance` a secas, aquí y en
// MedidorRendimiento.tsx: en la compilación del servidor, el `performance`
// suelto se sustituye por el sustituto de unenv, que acabó en el mismo trozo
// que canvg y core-js (~330 KB). El panel lo cargaba en cada página pintada en
// el servidor, aunque el medidor solo funciona en el navegador.

export function crearMedidor(alCambiar: () => void) {
  const historial: MedidaPantalla[] = [];
  let actual: Pantalla | null = null;

  const empezar = (ruta: string) => {
    if (actual) cerrarRed(actual);
    actual = {
      ruta,
      inicio: globalThis.performance.now(),
      msResuelta: null,
      msLista: null,
      consultas: {},
      red: { peticiones: 0, kb: 0, supabase: 0, serverFn: 0, authUser: 0 },
      iniciosConsulta: new Map(),
    };
    historial.push(actual);
    if (historial.length > 50) historial.shift();
    alCambiar();
  };

  const cerrarRed = (p: Pantalla) => {
    const entradas = globalThis.performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    const red = { peticiones: 0, kb: 0, supabase: 0, serverFn: 0, authUser: 0 };
    for (const e of entradas) {
      if (e.startTime < p.inicio) continue;
      const deSupabase = e.name.includes("supabase.co");
      const deServerFn = e.name.includes("_serverFn");
      if (!deSupabase && !deServerFn) continue;
      red.peticiones += 1;
      red.kb += (e.transferSize || 0) / 1024;
      if (deSupabase) red.supabase += 1;
      if (deServerFn) red.serverFn += 1;
      if (e.name.includes("/auth/v1/user")) red.authUser += 1;
    }
    red.kb = redondear(red.kb);
    p.red = red;
  };

  return {
    historial,
    actual: () => actual,
    navegacionEmpieza: (ruta: string) => empezar(ruta),
    navegacionResuelta: (ruta: string) => {
      if (!actual) empezar(ruta);
      const p = actual!;
      p.ruta = ruta;
      p.msResuelta = redondear(globalThis.performance.now() - p.inicio);
      alCambiar();
    },
    /** Se llama en el primer fotograma sin consultas en marcha. */
    pantallaLista: () => {
      const p = actual;
      if (!p || p.msResuelta == null) return;
      p.msLista = redondear(globalThis.performance.now() - p.inicio);
      cerrarRed(p);
      alCambiar();
    },
    consultaEmpieza: (hash: string) => {
      actual?.iniciosConsulta.set(hash, globalThis.performance.now());
    },
    consultaTermina: (hash: string, nombre: string, datos: unknown, error: boolean) => {
      const p = actual;
      if (!p) return;
      const inicio = p.iniciosConsulta.get(hash);
      if (inicio == null) return;
      p.iniciosConsulta.delete(hash);
      const m = (p.consultas[nombre] ??= { peticiones: 0, ms: 0, filas: 0, errores: 0 });
      m.peticiones += 1;
      m.ms = redondear(m.ms + (globalThis.performance.now() - inicio));
      if (error) m.errores += 1;
      else m.filas += contarFilas(datos);
      cerrarRed(p);
      alCambiar();
    },
    /** Lo que se copia al portapapeles: sin los campos internos. */
    exportar: (): MedidaPantalla[] =>
      historial.map(({ ruta, msResuelta, msLista, consultas, red }) => ({
        ruta,
        msResuelta,
        msLista,
        consultas,
        red,
      })),
  };
}

export type Medidor = ReturnType<typeof crearMedidor>;
