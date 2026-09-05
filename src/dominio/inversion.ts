/**
 * La cuenta de la inversión de cada socio.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin base de datos.
 *
 * ## Qué significa cada número
 *
 *   aportado    lo que el socio ha metido
 *   recuperado  lo que ha sacado, sea devolución o reparto
 *   pendiente   aportado − recuperado, o sea lo que todavía tiene dentro
 *
 * `pendiente` puede salir **negativo**, y no es un error: significa que ese
 * socio ha sacado más de lo que puso. Redondearlo a cero escondería justo el
 * dato por el que se mira esta pantalla.
 *
 * ## El porcentaje
 *
 * Se calcula sobre lo APORTADO, no sobre lo pendiente. Quién puso qué parte del
 * capital no cambia porque alguien recupere antes que otro; el reparto se pactó
 * con lo que cada uno metió.
 */

export type TipoInversion = "aportacion" | "retirada";

export type ApunteInversion = {
  socio_nombre?: string | null;
  tipo: TipoInversion;
  importe: number;
};

export type SaldoSocio = {
  socio: string;
  aportado: number;
  recuperado: number;
  /** Lo que sigue dentro. Negativo si ha sacado más de lo que puso. */
  pendiente: number;
  /** Su parte del capital aportado, en tanto por ciento. 0 si nadie ha puesto nada. */
  porcentaje: number;
  apuntes: number;
};

export type TotalesInversion = {
  aportado: number;
  recuperado: number;
  pendiente: number;
};

/** Dos decimales, alejándose del cero. El mismo redondeo que `importes.ts`. */
function redondear(n: number): number {
  const signo = n < 0 ? -1 : 1;
  return (signo * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

function valido(importe: unknown): number {
  const n = Number(importe);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function totalesInversion(apuntes: readonly ApunteInversion[]): TotalesInversion {
  let aportado = 0;
  let recuperado = 0;
  for (const a of apuntes) {
    const n = valido(a.importe);
    if (a.tipo === "aportacion") aportado += n;
    else if (a.tipo === "retirada") recuperado += n;
  }
  aportado = redondear(aportado);
  recuperado = redondear(recuperado);
  return { aportado, recuperado, pendiente: redondear(aportado - recuperado) };
}

/**
 * Una línea por socio, del que más ha puesto al que menos.
 *
 * Un apunte sin nombre de socio no debería existir —la base lo impide— pero si
 * llegara, se agrupa aparte en vez de desaparecer: un euro que no se sabe de
 * quién es sigue siendo un euro que descuadra la suma.
 */
export function porSocioInversion(apuntes: readonly ApunteInversion[]): SaldoSocio[] {
  const acc = new Map<string, { aportado: number; recuperado: number; apuntes: number }>();
  for (const a of apuntes) {
    const socio = a.socio_nombre?.trim() || "Sin socio";
    const previo = acc.get(socio) ?? { aportado: 0, recuperado: 0, apuntes: 0 };
    const n = valido(a.importe);
    if (a.tipo === "aportacion") previo.aportado += n;
    else if (a.tipo === "retirada") previo.recuperado += n;
    previo.apuntes += 1;
    acc.set(socio, previo);
  }

  const totalAportado = Array.from(acc.values()).reduce((s, v) => s + v.aportado, 0);

  return Array.from(acc, ([socio, v]) => {
    const aportado = redondear(v.aportado);
    const recuperado = redondear(v.recuperado);
    return {
      socio,
      aportado,
      recuperado,
      pendiente: redondear(aportado - recuperado),
      porcentaje: totalAportado > 0 ? redondear((v.aportado / totalAportado) * 100) : 0,
      apuntes: v.apuntes,
    };
  }).sort((a, b) => b.aportado - a.aportado || a.socio.localeCompare(b.socio, "es"));
}
