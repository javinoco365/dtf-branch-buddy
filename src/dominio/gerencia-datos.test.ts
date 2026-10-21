import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gastosConCompras } from "./compras";
import {
  gastosDelGrupo,
  GRUPOS,
  pedidosDocumentados,
  pendienteDocumentar,
  ventasDelGrupo,
  type Grupo,
} from "./grupos";
import {
  AJUSTES_POR_DEFECTO,
  aplicarAjustesVentas,
  filtrarCobrosGerencia,
  filtrarPendientesGerencia,
  filtrarVentas,
  webSinPagar,
  type FiltroGerencia,
} from "./gerencia";
import type { Comparacion, Seleccion } from "./periodos";
import { TIENDA_TEXTIL } from "./cobros";
import {
  FUENTE_DEL_CAMPO,
  FUENTES_DE_PESTANA,
  montarDatosGerencia,
  montarGastosGerencia,
  montarPendienteDocumentar,
  type DatosGerencia,
  type EntradasGerencia,
  type FuenteGerencia,
  type PestanaGerencia,
} from "./gerencia-datos";

// Casos de prueba (cancelados, devoluciones, web sin pagar, canje ticket →
// factura, rectificativa sin pedido, pedido web de las 23:15 UTC del 31-10,
// textil sin coste…). Solo para las pruebas: no salen en ninguna pantalla.
const banco = JSON.parse(
  readFileSync(new URL("./__fixtures__/banco-gerencia.json", import.meta.url), "utf8"),
);

/**
 * El cuerpo del `useMemo` de `routes/panel/gerencia.tsx` antes de sacarlo al
 * dominio, copiado sin tocar una coma. Es la referencia: lo de ahora tiene
 * que dar exactamente lo mismo.
 */
function referencia(e: EntradasGerencia): DatosAntes | null {
  const SIN_AJUSTES = { ajustes: AJUSTES_POR_DEFECTO, gastos: [], objetivos: [] };
  const ajustes = e.ajustes;
  const compras = e.compras;
  const ventas = { data: e.ventas };
  const ventasPrevias = { data: e.ventasPrevias };
  const docs = { data: e.docs };
  const docsPrevios = { data: e.docsPrevios };
  const cobros = { data: e.cobros };
  const cobrosPrevios = { data: e.cobrosPrevios };
  const pendientes = { data: e.pendientes };
  const caja = { data: e.caja };
  const banco = { data: e.banco };
  const { grupo, filtro, rango, costeMetro, tiendas, hoy } = e;
  const periodo = { seleccion: e.seleccion, comparacion: e.comparacion };

  // Si los ajustes no se pueden leer, Gerencia sigue con los de siempre.
  const aj = ajustes.data ?? (ajustes.isError ? SIN_AJUSTES : null);
  if (!ventas.data || !aj) return null;
  // Sin las compras, el beneficio saldría mejor de lo que es: se espera.
  if (!compras.data && !compras.isError) return null;
  const gastos = gastosConCompras(aj.gastos, compras.data ?? []);
  // Para separar A y B hacen falta los documentos; sin ellos, todavía no.
  if (grupo !== "total" && (!docs.data || (periodo.comparacion && !docsPrevios.data))) {
    return null;
  }
  const a = aj.ajustes;
  const delPeriodo = filtrarVentas(ventas.data, filtro);
  const todas = aplicarAjustesVentas(delPeriodo, a);
  const documentados = pedidosDocumentados(docs.data ?? []);
  const documentadosPrevios = pedidosDocumentados(docsPrevios.data ?? []);
  return {
    grupo,
    ventasTodas: todas,
    documentados: docs.data ? documentados : null,
    pendiente: docs.data ? pendienteDocumentar(todas, documentados) : null,
    filtro,
    seleccion: periodo.seleccion,
    rango,
    comparacion: periodo.comparacion,
    costeMetro,
    tiendas,
    ventas: ventasDelGrupo(todas, documentados, grupo),
    ventasPrevias: ventasDelGrupo(
      aplicarAjustesVentas(filtrarVentas(ventasPrevias.data ?? [], filtro), a),
      documentadosPrevios,
      grupo,
    ),
    webSinPagar: webSinPagar(delPeriodo),
    ajustes: a,
    gastos,
    gastosDelGrupo: gastosDelGrupo(gastos, grupo),
    objetivos: aj.objetivos,
    cobros: filtrarCobrosGerencia(cobros.data?.cobros ?? [], filtro),
    cobrosPrevios: filtrarCobrosGerencia(cobrosPrevios.data?.cobros ?? [], filtro),
    cobrosDisponibles: cobros.data?.disponible ?? false,
    pendientes: filtrarPendientesGerencia(pendientes.data?.pedidos ?? [], filtro),
    pendientesDisponibles: pendientes.data?.disponible ?? false,
    caja: caja.data?.movimientos,
    banco: banco.data,
    hoy,
  };
}

/** Lo que daba antes: sin los dos campos que se añadieron al repartir por pestaña. */
type DatosAntes = Omit<DatosGerencia, "cobrosLeidos" | "pendientesLeidos">;
function comoAntes(d: DatosGerencia | null): DatosAntes | null {
  if (!d) return null;
  const resto: Partial<DatosGerencia> = { ...d };
  delete resto.cobrosLeidos;
  delete resto.pendientesLeidos;
  return resto as DatosAntes;
}

const fecha = (s: string) => new Date(s);
const rango = { desde: fecha(banco.rango.desde), hasta: fecha(banco.rango.hasta) };
const previo = { desde: fecha(banco.previo.desde), hasta: fecha(banco.previo.hasta) };
const seleccion: Seleccion = { tipo: "mes", ref: fecha(banco.hoy) };
const comparacion: Comparacion = {
  actual: rango,
  previo,
  etiqueta: "septiembre 2026",
  parcial: true,
};

/** Todo leído, con la comparación puesta. */
function completas(over: Partial<EntradasGerencia> = {}): EntradasGerencia {
  return {
    grupo: "total",
    filtro: { tienda: "todas", canal: "todos" },
    seleccion,
    rango,
    comparacion,
    costeMetro: 3.25,
    tiendas: banco.tiendas,
    hoy: fecha(banco.hoy),
    ventas: banco.ventas,
    ventasPrevias: banco.ventasPrevias,
    docs: banco.docs,
    docsPrevios: banco.docsPrevios,
    ajustes: { data: banco.ajustes, isError: false },
    compras: { data: banco.compras, isError: false },
    cobros: banco.cobros,
    cobrosPrevios: banco.cobrosPrevios,
    pendientes: banco.pendientes,
    caja: banco.caja,
    banco: banco.banco,
    ...over,
  };
}

const FILTROS: FiltroGerencia[] = [
  { tienda: "todas", canal: "todos" },
  { tienda: "t-sur", canal: "todos" },
  { tienda: "todas", canal: "web" },
  { tienda: "todas", canal: "manual" },
  { tienda: TIENDA_TEXTIL.id, canal: "todos" },
  { tienda: "t-norte", canal: "textil" },
];

const SIN_PAGAR_NO_CUENTA = {
  ...banco.ajustes,
  ajustes: { ...banco.ajustes.ajustes, web_sin_pagar_cuenta: false },
};

/** Lo que puede faltar mientras se lee, o fallar. */
const ESTADOS: Record<string, Partial<EntradasGerencia>> = {
  "todo leído": {},
  "sin comparación": { comparacion: null, ventasPrevias: [], docsPrevios: [] },
  "web sin pagar no cuenta": { ajustes: { data: SIN_PAGAR_NO_CUENTA, isError: false } },
  "sin ventas todavía": { ventas: undefined },
  "sin ajustes todavía": { ajustes: { data: undefined, isError: false } },
  "ajustes con error": { ajustes: { data: undefined, isError: true } },
  "sin compras todavía": { compras: { data: undefined, isError: false } },
  "compras con error": { compras: { data: undefined, isError: true } },
  "sin documentos todavía": { docs: undefined },
  "sin documentos previos todavía": { docsPrevios: undefined },
  "sin cobros, pendientes, caja ni banco": {
    cobros: undefined,
    cobrosPrevios: undefined,
    pendientes: undefined,
    caja: undefined,
    banco: undefined,
  },
  "cobros sin migración": { cobros: { disponible: false, cobros: [] } },
};

describe("montarDatosGerencia", () => {
  for (const [nombre, estado] of Object.entries(ESTADOS)) {
    for (const g of GRUPOS) {
      for (const filtro of FILTROS) {
        it(`${nombre} · grupo ${g.valor} · ${filtro.tienda}/${filtro.canal}: igual que antes`, () => {
          const e = completas({ ...estado, grupo: g.valor as Grupo, filtro });
          expect(comoAntes(montarDatosGerencia(e))).toStrictEqual(referencia(e));
        });
      }
    }
  }

  it("el banco de casos pasa por todas las ramas", () => {
    const d = montarDatosGerencia(completas())!;
    // Sin documento: p-4 (web sin pagar), p-5 (31-10 a las 23:15 UTC), p-6 (su
    // factura está rectificada) y x-2. El cancelado p-2 no cuenta.
    expect(d.pendiente).toEqual({
      pedidos: 4,
      vendido: 621.1,
      porTienda: [
        { tienda_id: "t-norte", pedidos: 1, vendido: 363 },
        { tienda_id: "t-sur", pedidos: 2, vendido: 149.2 },
        { tienda_id: "textil-personalizado", pedidos: 1, vendido: 108.9 },
      ],
    });
    expect(d.webSinPagar).toEqual({ pedidos: 1, importe: 100.8 });
    // Un gasto de compra (publicidad) y la amortización de la máquina se suman a los tres de Ajustes.
    expect(d.gastos.map((g) => g.id).sort()).toEqual(
      ["compra:k-2", "g-1", "g-2", "g-3", "amortizacion:k-3"].sort(),
    );
    const b = montarDatosGerencia(completas({ grupo: "b" }))!;
    expect(b.gastosDelGrupo.map((g) => g.id)).toEqual(["g-2"]);
    expect(b.ventas.map((v) => v.id)).toEqual(["p-2", "p-4", "p-5", "p-6", "x-2"]);
  });

  it("espera a las ventas, a los ajustes y a las compras", () => {
    expect(montarDatosGerencia(completas({ ventas: undefined }))).toBeNull();
    expect(
      montarDatosGerencia(completas({ ajustes: { data: undefined, isError: false } })),
    ).toBeNull();
    expect(
      montarDatosGerencia(completas({ compras: { data: undefined, isError: false } })),
    ).toBeNull();
    expect(montarDatosGerencia(completas({ grupo: "a", docs: undefined }))).toBeNull();
    expect(
      montarDatosGerencia(completas({ grupo: "total", docs: undefined }))?.pendiente,
    ).toBeNull();
  });
});

/**
 * Lo que la pantalla deja sin pedir cuando la pestaña no lo usa: en las
 * entradas llega `undefined` (y el coste por metro, 0).
 */
function soloLoDe(e: EntradasGerencia, fuentes: readonly FuenteGerencia[]): EntradasGerencia {
  const pide = (f: FuenteGerencia) => fuentes.includes(f);
  return {
    ...e,
    ventasPrevias: pide("ventasPrevias") ? e.ventasPrevias : undefined,
    docsPrevios: pide("ventasPrevias") ? e.docsPrevios : undefined,
    compras: pide("compras") ? e.compras : { data: undefined, isError: false },
    cobros: pide("cobros") ? e.cobros : undefined,
    cobrosPrevios: pide("cobrosPrevios") ? e.cobrosPrevios : undefined,
    pendientes: pide("pendientes") ? e.pendientes : undefined,
    caja: pide("caja") ? e.caja : undefined,
    banco: pide("banco") ? e.banco : undefined,
    costeMetro: pide("costeMetro") ? e.costeMetro : 0,
  };
}

const CAMPOS = Object.keys(FUENTE_DEL_CAMPO) as (keyof DatosGerencia)[];

describe("cada pestaña pide lo suyo", () => {
  for (const [pestana, fuentes] of Object.entries(FUENTES_DE_PESTANA) as [
    PestanaGerencia,
    readonly FuenteGerencia[],
  ][]) {
    // Los campos que la pestaña puede leer: los de sus lecturas y los que no dependen de ninguna.
    const suyos = CAMPOS.filter((c) => {
      const f = FUENTE_DEL_CAMPO[c];
      return f === null || fuentes.includes(f);
    });
    for (const [nombre, estado] of Object.entries(ESTADOS)) {
      for (const g of GRUPOS) {
        for (const filtro of FILTROS) {
          it(`${pestana} · ${nombre} · grupo ${g.valor} · ${filtro.tienda}/${filtro.canal}`, () => {
            const e = completas({ ...estado, grupo: g.valor as Grupo, filtro });
            const todo = montarDatosGerencia(e);
            const suyo = montarDatosGerencia(soloLoDe(e, fuentes), fuentes);
            // Nunca espera más que antes…
            if (todo) expect(suyo).not.toBeNull();
            // …y lo que enseña es lo mismo, campo a campo.
            if (todo && suyo) {
              for (const c of suyos) expect(suyo[c], c).toStrictEqual(todo[c]);
            }
          });
        }
      }
    }
  }

  it("espera a lo suyo y solo a lo suyo", () => {
    const sinVentas = completas({ ventas: undefined, docs: undefined });
    expect(montarDatosGerencia(sinVentas, FUENTES_DE_PESTANA.ventas)).toBeNull();
    expect(montarDatosGerencia(sinVentas, FUENTES_DE_PESTANA.tesoreria)).not.toBeNull();
    expect(montarDatosGerencia(sinVentas, FUENTES_DE_PESTANA.comercial)).not.toBeNull();
    // Sin ventas no hay pendiente: nunca un cero que no es.
    expect(montarDatosGerencia(sinVentas, FUENTES_DE_PESTANA.fiscal)?.pendiente).toBeNull();
    const sinCompras = completas({ compras: { data: undefined, isError: false } });
    expect(montarDatosGerencia(sinCompras, FUENTES_DE_PESTANA.margen)).toBeNull();
    expect(montarDatosGerencia(sinCompras, FUENTES_DE_PESTANA.textil)).not.toBeNull();
    const sinAjustes = completas({ ajustes: { data: undefined, isError: false } });
    expect(montarDatosGerencia(sinAjustes, FUENTES_DE_PESTANA.clientes)).toBeNull();
    expect(montarDatosGerencia(sinAjustes, FUENTES_DE_PESTANA.tesoreria)).not.toBeNull();
    const enB = completas({ grupo: "b", docsPrevios: undefined });
    expect(montarDatosGerencia(enB, FUENTES_DE_PESTANA.textil)).toBeNull();
    expect(montarDatosGerencia(enB, FUENTES_DE_PESTANA.produccion)).not.toBeNull();
  });

  it("cobros y pendientes: leídos o todavía no", () => {
    const d = montarDatosGerencia(completas({ cobros: undefined, pendientes: undefined }))!;
    expect([d.cobrosLeidos, d.cobrosDisponibles, d.pendientesLeidos]).toEqual([
      false,
      false,
      false,
    ]);
    const sin = montarDatosGerencia(completas({ cobros: { disponible: false, cobros: [] } }))!;
    expect([sin.cobrosLeidos, sin.cobrosDisponibles]).toEqual([true, false]);
  });
});

describe("la insignia y el Resumen diario, aparte", () => {
  for (const [nombre, estado] of Object.entries(ESTADOS)) {
    for (const filtro of FILTROS) {
      it(`${nombre} · ${filtro.tienda}/${filtro.canal}: lo mismo que con todo`, () => {
        const e = completas({ ...estado, filtro });
        const todo = montarDatosGerencia(e);
        if (todo) {
          expect(montarPendienteDocumentar(e)).toStrictEqual(todo.pendiente);
          expect(montarGastosGerencia(e)).toStrictEqual(todo.gastos);
        }
        if (!e.ventas || !e.docs) expect(montarPendienteDocumentar(e)).toBeNull();
      });
    }
  }
});
