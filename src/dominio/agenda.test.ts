import { describe, expect, it } from "vitest";
import {
  diaDeMadrid,
  diasEntre,
  diasVencida,
  enlaceSegunCategoria,
  esDia,
  esHora,
  esNueva,
  esVencida,
  FILTROS_LISTA_INICIALES,
  hayFiltrosLista,
  horaDeMadrid,
  instanteDeMadrid,
  lunesDe,
  momentosDe,
  nombreCategoriaRepetido,
  ordenarTareas,
  pasaFiltros,
  pasaFiltrosSinEstado,
  pasaPersona,
  resumenDe,
  sumarDias,
  validarTarea,
  type BorradorTarea,
  type FiltrosLista,
  type Tarea,
} from "./agenda";

const YO = "jn";
const HOY = "2026-11-12"; // jueves

let n = 0;
function tarea(t: Partial<Tarea> & { dia?: string; hora?: string } = {}): Tarea {
  const { dia = HOY, hora, ...resto } = t;
  return {
    id: `t${++n}`,
    titulo: "Tarea",
    notas: null,
    categoriaId: "gestion",
    prioridad: "normal",
    todoElDia: !hora,
    inicio: instanteDeMadrid(dia, hora ?? "00:00"),
    fin: null,
    deSocioId: YO,
    paraSocioId: YO,
    pedidoId: null,
    clienteId: null,
    enlaceTexto: null,
    estado: "pendiente",
    hechaEn: null,
    vistaEn: null,
    ...resto,
  };
}

const ctx = { yo: YO, hoy: HOY };
const filtros = (f: Partial<FiltrosLista>): FiltrosLista => ({ ...FILTROS_LISTA_INICIALES, ...f });

describe("horas de Madrid", () => {
  it("invierno: Madrid va una hora por delante de UTC", () => {
    expect(instanteDeMadrid("2026-11-12", "09:30")).toBe("2026-11-12T08:30:00.000Z");
  });

  it("verano: dos horas por delante", () => {
    expect(instanteDeMadrid("2026-07-01", "09:30")).toBe("2026-07-01T07:30:00.000Z");
  });

  it("todo el día: las 00:00 de Madrid, que en UTC es el día anterior", () => {
    expect(instanteDeMadrid("2026-11-12")).toBe("2026-11-11T23:00:00.000Z");
    expect(diaDeMadrid(instanteDeMadrid("2026-11-12"))).toBe("2026-11-12");
  });

  it("el día y la hora vuelven a ser los mismos al leerlos", () => {
    for (const [d, h] of [
      ["2026-03-28", "23:59"],
      ["2026-03-29", "00:00"],
      ["2026-03-29", "03:00"],
      ["2026-10-25", "00:00"],
      ["2026-10-25", "04:15"],
      ["2026-12-31", "23:30"],
    ] as const) {
      const i = instanteDeMadrid(d, h);
      expect(diaDeMadrid(i)).toBe(d);
      expect(horaDeMadrid(i)).toBe(h);
    }
  });

  it("la hora que no existe en marzo (02:30) cae en la siguiente", () => {
    expect(horaDeMadrid(instanteDeMadrid("2026-03-29", "02:30"))).toBe("03:30");
  });

  it("rechaza días y horas mal escritos", () => {
    expect(() => instanteDeMadrid("12/11/2026")).toThrow();
    expect(() => instanteDeMadrid("2026-11-12", "25:00")).toThrow();
  });
});

describe("días", () => {
  it("esDia y esHora", () => {
    expect(esDia("2026-02-28")).toBe(true);
    expect(esDia("2026-02-30")).toBe(false);
    expect(esDia("2026-2-3")).toBe(false);
    expect(esHora("09:05")).toBe(true);
    expect(esHora("9:05")).toBe(false);
    expect(esHora("24:00")).toBe(false);
  });

  it("sumarDias cruza meses, años y el cambio de hora", () => {
    expect(sumarDias("2026-10-24", 2)).toBe("2026-10-26");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("lunesDe: el lunes de su semana; un lunes es su propio lunes", () => {
    expect(lunesDe("2026-11-12")).toBe("2026-11-09");
    expect(lunesDe("2026-11-09")).toBe("2026-11-09");
    expect(lunesDe("2026-11-15")).toBe("2026-11-09");
  });

  it("diasEntre", () => {
    expect(diasEntre("2026-11-10", "2026-11-12")).toBe(2);
    expect(diasEntre("2026-11-12", "2026-11-10")).toBe(-2);
  });
});

describe("vencidas y nuevas", () => {
  it("vencida: pendiente de un día anterior", () => {
    expect(esVencida(tarea({ dia: "2026-11-10" }), HOY)).toBe(true);
    expect(diasVencida(tarea({ dia: "2026-11-10" }), HOY)).toBe(2);
  });

  it("lo de hoy no está vencido aunque haya pasado su hora", () => {
    expect(esVencida(tarea({ dia: HOY, hora: "00:30" }), HOY)).toBe(false);
  });

  it("una realizada o cancelada nunca está vencida", () => {
    expect(esVencida(tarea({ dia: "2026-11-01", estado: "hecha" }), HOY)).toBe(false);
    expect(esVencida(tarea({ dia: "2026-11-01", estado: "cancelada" }), HOY)).toBe(false);
    expect(diasVencida(tarea({ dia: "2026-11-01", estado: "hecha" }), HOY)).toBe(0);
  });

  it("nueva: me la han mandado y no la he abierto", () => {
    expect(esNueva(tarea({ deSocioId: "mn", paraSocioId: YO }), YO)).toBe(true);
    expect(esNueva(tarea({ deSocioId: "mn", paraSocioId: YO, vistaEn: "x" }), YO)).toBe(false);
  });

  it("no es nueva la que me mando yo, la de otro, ni la que ya no está pendiente", () => {
    expect(esNueva(tarea({ deSocioId: YO, paraSocioId: YO }), YO)).toBe(false);
    expect(esNueva(tarea({ deSocioId: "mn", paraSocioId: "ar" }), YO)).toBe(false);
    expect(esNueva(tarea({ deSocioId: "mn", paraSocioId: YO, estado: "hecha" }), YO)).toBe(false);
    expect(esNueva(tarea({ deSocioId: "mn", paraSocioId: YO }), null)).toBe(false);
  });
});

describe("Para y De", () => {
  const paraMi = tarea({ deSocioId: "mn", paraSocioId: YO });
  const mandada = tarea({ deSocioId: YO, paraSocioId: "mn" });
  const ajena = tarea({ deSocioId: "ar", paraSocioId: "mn" });
  const propia = tarea({ deSocioId: YO, paraSocioId: YO });

  it("Para mí", () => {
    const f = { para: "yo", de: "todos" };
    expect([paraMi, mandada, ajena, propia].map((t) => pasaPersona(t, f, YO))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("Enviadas por mí: las que mandé a otros, no las mías", () => {
    const f = { para: "otros", de: "yo" };
    expect([paraMi, mandada, ajena, propia].map((t) => pasaPersona(t, f, YO))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("lo que mandé a Miguel", () => {
    const f = { para: "mn", de: "yo" };
    expect([paraMi, mandada, ajena].map((t) => pasaPersona(t, f, YO))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("Todas", () => {
    const f = { para: "todos", de: "todos" };
    expect([paraMi, mandada, ajena, propia].every((t) => pasaPersona(t, f, YO))).toBe(true);
  });
});

describe("filtros de la lista", () => {
  it("por defecto, solo pendientes", () => {
    expect(pasaFiltros(tarea(), FILTROS_LISTA_INICIALES, ctx)).toBe(true);
    expect(pasaFiltros(tarea({ estado: "hecha" }), FILTROS_LISTA_INICIALES, ctx)).toBe(false);
    expect(pasaFiltros(tarea({ estado: "hecha" }), filtros({ estado: "hecha" }), ctx)).toBe(true);
    expect(pasaFiltros(tarea({ estado: "cancelada" }), filtros({ estado: "todas" }), ctx)).toBe(
      true,
    );
  });

  it("el estado no cuenta en pasaFiltrosSinEstado (para los números de las pestañas)", () => {
    expect(pasaFiltrosSinEstado(tarea({ estado: "hecha" }), FILTROS_LISTA_INICIALES, ctx)).toBe(
      true,
    );
  });

  it("prioridad y categoría", () => {
    const f = filtros({ prioridades: ["urgente", "alta"], categoriaId: "pedido" });
    expect(pasaFiltros(tarea({ prioridad: "urgente", categoriaId: "pedido" }), f, ctx)).toBe(true);
    expect(pasaFiltros(tarea({ prioridad: "normal", categoriaId: "pedido" }), f, ctx)).toBe(false);
    expect(pasaFiltros(tarea({ prioridad: "alta", categoriaId: "gestion" }), f, ctx)).toBe(false);
  });

  it("el buscador mira título, enlace y notas, sin acentos ni mayúsculas", () => {
    const t = tarea({
      titulo: "Llamar",
      enlaceTexto: "Pedido 1042 · Taller Ruiz",
      notas: "Logo v3",
    });
    expect(pasaFiltros(t, filtros({ texto: "1042" }), ctx)).toBe(true);
    expect(pasaFiltros(t, filtros({ texto: "taller ruiz" }), ctx)).toBe(true);
    expect(pasaFiltros(t, filtros({ texto: "LOGO" }), ctx)).toBe(true);
    expect(pasaFiltros(tarea({ titulo: "Revisión" }), filtros({ texto: "revision" }), ctx)).toBe(
      true,
    );
    expect(pasaFiltros(t, filtros({ texto: "nada" }), ctx)).toBe(false);
  });

  it("periodos", () => {
    const ayer = tarea({ dia: "2026-11-11" });
    const hoy = tarea({ dia: HOY });
    const domingo = tarea({ dia: "2026-11-15" });
    const lunesQueViene = tarea({ dia: "2026-11-16" });
    const otroMes = tarea({ dia: "2026-12-01" });
    const de = (p: FiltrosLista["periodo"], extra: Partial<FiltrosLista> = {}) =>
      [ayer, hoy, domingo, lunesQueViene, otroMes].map((t) =>
        pasaFiltros(t, filtros({ periodo: p, ...extra }), ctx),
      );
    expect(de("vencidas")).toEqual([true, false, false, false, false]);
    expect(de("hoy")).toEqual([false, true, false, false, false]);
    expect(de("semana")).toEqual([true, true, true, false, false]);
    expect(de("mes")).toEqual([true, true, true, true, false]);
    expect(de("rango", { desde: "2026-11-12", hasta: "2026-11-16" })).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(de("rango", { desde: "", hasta: "" })).toEqual([true, true, true, true, true]);
  });

  it("solo nuevas", () => {
    const f = filtros({ soloNuevas: true });
    expect(pasaFiltros(tarea({ deSocioId: "mn" }), f, ctx)).toBe(true);
    expect(pasaFiltros(tarea({ deSocioId: "mn", vistaEn: "x" }), f, ctx)).toBe(false);
  });

  it("hayFiltrosLista no cuenta el estado", () => {
    expect(hayFiltrosLista(FILTROS_LISTA_INICIALES)).toBe(false);
    expect(hayFiltrosLista(filtros({ estado: "hecha" }))).toBe(false);
    expect(hayFiltrosLista(filtros({ texto: " " }))).toBe(false);
    expect(hayFiltrosLista(filtros({ prioridades: ["baja"] }))).toBe(true);
  });
});

describe("ordenarTareas", () => {
  const a = tarea({ id: "a", dia: "2026-11-10", prioridad: "baja" });
  const b = tarea({ id: "b", dia: HOY, prioridad: "urgente" });
  const c = tarea({ id: "c", dia: HOY, prioridad: "alta" });

  it("por fecha: las antiguas primero y, a igual día, la más importante", () => {
    expect(ordenarTareas([c, b, a], { campo: "fecha", dir: 1 }).map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("en Realizadas, las más recientes primero", () => {
    expect(ordenarTareas([a, b], { campo: "fecha", dir: 1 }, "hecha").map((t) => t.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("por prioridad y al revés", () => {
    expect(ordenarTareas([a, c, b], { campo: "prioridad", dir: 1 }).map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(ordenarTareas([a, c, b], { campo: "prioridad", dir: -1 }).map((t) => t.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("no toca la lista original", () => {
    const lista = [c, b, a];
    ordenarTareas(lista, { campo: "fecha", dir: 1 });
    expect(lista.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
});

describe("resumenDe", () => {
  it("hoy, vencidas y nuevas; el aviso cuenta cada tarea una vez", () => {
    const tareas = [
      tarea({ dia: HOY }), // hoy
      tarea({ dia: HOY, deSocioId: "mn" }), // hoy y nueva
      tarea({ dia: "2026-11-10" }), // vencida
      tarea({ dia: "2026-11-20", deSocioId: "ar" }), // nueva
      tarea({ dia: "2026-11-20" }), // nada
      tarea({ dia: HOY, estado: "hecha" }), // no cuenta
      tarea({ dia: HOY, paraSocioId: "mn" }), // de otro
    ];
    expect(resumenDe(tareas, YO, HOY)).toEqual({ hoy: 2, vencidas: 1, nuevas: 2, aviso: 4 });
  });

  it("sin persona, nada", () => {
    expect(resumenDe([tarea()], null, HOY)).toEqual({ hoy: 0, vencidas: 0, nuevas: 0, aviso: 0 });
  });
});

describe("validarTarea", () => {
  const base: BorradorTarea = {
    titulo: "Llamar",
    notas: "",
    categoriaId: "gestion",
    prioridad: "normal",
    todoElDia: true,
    dia: HOY,
    horaInicio: "09:00",
    horaFin: "10:00",
    deSocioId: YO,
    paraSocioId: "mn",
    pedidoId: null,
    clienteId: null,
  };
  const sinEnlace = { enlace: null };

  it("un borrador completo no tiene errores", () => {
    expect(validarTarea(base, sinEnlace)).toEqual({});
  });

  it("título vacío o demasiado largo", () => {
    expect(validarTarea({ ...base, titulo: "  " }, sinEnlace).titulo).toBe(
      "Escribe qué hay que hacer.",
    );
    expect(validarTarea({ ...base, titulo: "x".repeat(201) }, sinEnlace).titulo).toBeTruthy();
  });

  it("sin categoría", () => {
    expect(validarTarea(base, null).categoria).toBe("Elige una categoría.");
  });

  it("Pedido pide pedido y Cliente pide cliente", () => {
    expect(validarTarea(base, { enlace: "pedido" }).enlace).toMatch(/pedido/);
    expect(validarTarea({ ...base, pedidoId: "p1" }, { enlace: "pedido" }).enlace).toBeUndefined();
    expect(validarTarea(base, { enlace: "cliente" }).enlace).toMatch(/cliente/);
  });

  it("con hora: las dos horas y el fin después del inicio", () => {
    const conHora = { ...base, todoElDia: false };
    expect(validarTarea(conHora, sinEnlace)).toEqual({});
    expect(validarTarea({ ...conHora, horaFin: "09:00" }, sinEnlace).hora).toMatch(/posterior/);
    expect(validarTarea({ ...conHora, horaInicio: "" }, sinEnlace).hora).toBeTruthy();
  });

  it("todo el día no mira las horas", () => {
    expect(validarTarea({ ...base, horaFin: "08:00" }, sinEnlace)).toEqual({});
  });

  it("día, de y para", () => {
    const e = validarTarea({ ...base, dia: "", deSocioId: "", paraSocioId: "" }, sinEnlace);
    expect(Object.keys(e).sort()).toEqual(["de", "dia", "para"]);
  });
});

describe("momentosDe y enlaceSegunCategoria", () => {
  it("todo el día: inicio a las 00:00 y sin fin", () => {
    expect(momentosDe({ dia: HOY, todoElDia: true, horaInicio: "", horaFin: "" })).toEqual({
      inicio: "2026-11-11T23:00:00.000Z",
      fin: null,
    });
  });

  it("con hora: inicio y fin", () => {
    expect(
      momentosDe({ dia: HOY, todoElDia: false, horaInicio: "09:00", horaFin: "09:30" }),
    ).toEqual({ inicio: "2026-11-12T08:00:00.000Z", fin: "2026-11-12T08:30:00.000Z" });
  });

  it("solo se guarda el enlace que pide la categoría", () => {
    const b = { pedidoId: "p", clienteId: "c" };
    expect(enlaceSegunCategoria(b, { enlace: "pedido" })).toEqual({
      pedidoId: "p",
      clienteId: null,
    });
    expect(enlaceSegunCategoria(b, { enlace: "cliente" })).toEqual({
      pedidoId: null,
      clienteId: "c",
    });
    expect(enlaceSegunCategoria(b, { enlace: null })).toEqual({ pedidoId: null, clienteId: null });
  });
});

describe("nombreCategoriaRepetido", () => {
  const cats = [
    { id: "1", nombre: "Gestión" },
    { id: "2", nombre: "Pedido" },
  ];
  it("sin mirar mayúsculas, acentos ni espacios", () => {
    expect(nombreCategoriaRepetido(" gestion ", cats)).toBe(true);
    expect(nombreCategoriaRepetido("Proveedores", cats)).toBe(false);
  });
  it("renombrar una categoría con su propio nombre no es repetirlo", () => {
    expect(nombreCategoriaRepetido("Gestión", cats, "1")).toBe(false);
    expect(nombreCategoriaRepetido("Pedido", cats, "1")).toBe(true);
  });
});
