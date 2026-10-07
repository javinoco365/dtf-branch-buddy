import { describe, expect, it } from "vitest";
import {
  coincideImporte,
  detectarTraspasos,
  diasEntre,
  enVentana,
  esperadoDe,
  planConciliacion,
  reconoceContraparte,
  sugerencias,
  type Documento,
  type Movimiento,
} from "./motor-conciliacion";
import { calcularCompra } from "./compras";

const mov = (p: Partial<Movimiento> & { id: string }): Movimiento => ({
  fecha: "2026-11-05",
  concepto: "",
  importe: -100,
  cuenta_id: "principal",
  ...p,
});

const recibida = (
  p: Partial<Documento> & { id: string; liquido: number },
): Documento & { liquido: number } => ({
  tipo: "compra",
  fecha: "2026-11-02",
  contraparte: null,
  nif: null,
  referencia: null,
  esperado: esperadoDe("compra", p.liquido),
  ...p,
});

const emitida = (p: Partial<Documento> & { id: string; total: number }): Documento => ({
  tipo: "factura",
  fecha: "2026-11-02",
  contraparte: null,
  nif: null,
  referencia: null,
  esperado: esperadoDe("factura", p.total),
  ...p,
});

describe("importe contra el líquido", () => {
  it("un alquiler con IRPF casa por el líquido (1.020), no por el total (1.210)", () => {
    const { liquido, total } = calcularCompra({ base: 1000, tipo_iva: 0.21, tipo_irpf: 0.19 });
    expect(total).toBe(1210);
    expect(liquido).toBe(1020);
    const alquiler = recibida({ id: "alq", liquido, contraparte: "Inmuebles García López SL" });
    expect(coincideImporte(-1020, alquiler.esperado)).toBe(true);
    expect(coincideImporte(-1210, alquiler.esperado)).toBe(false);
  });

  it("redondeo: 33,33 al 21 % son 40,33 y se acepta un céntimo, no dos", () => {
    const { liquido } = calcularCompra({ base: 33.33, tipo_iva: 0.21, tipo_irpf: 0 });
    expect(liquido).toBe(40.33);
    const d = esperadoDe("compra", liquido);
    expect(coincideImporte(-40.33, d)).toBe(true);
    expect(coincideImporte(-40.34, d)).toBe(true);
    expect(coincideImporte(-40.32, d)).toBe(true);
    expect(coincideImporte(-40.35, d)).toBe(false);
  });

  it("los decimales de coma flotante no rompen la comparación", () => {
    expect(coincideImporte(-(0.1 + 0.2), -0.3)).toBe(true);
  });

  it("un cargo no casa con una factura emitida, ni un abono con una recibida", () => {
    expect(coincideImporte(-121, esperadoDe("factura", 121))).toBe(false);
    expect(coincideImporte(121, esperadoDe("compra", 121))).toBe(false);
  });
});

describe("ventana de fechas: de 5 días antes a 45 después", () => {
  it("bordes", () => {
    expect(diasEntre("2026-11-10", "2026-11-05")).toBe(-5);
    expect(enVentana("2026-11-10", "2026-11-05")).toBe(true);
    expect(enVentana("2026-11-10", "2026-11-04")).toBe(false);
    expect(enVentana("2026-11-10", "2026-12-25")).toBe(true); // +45
    expect(enVentana("2026-11-10", "2026-12-26")).toBe(false); // +46
  });

  it("no le afecta el cambio de hora", () => {
    expect(diasEntre("2026-10-24", "2026-10-26")).toBe(2);
    expect(diasEntre("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("contraparte", () => {
  const d = recibida({
    id: "x",
    liquido: 10,
    contraparte: "Inmuebles García López SL",
    nif: "B-12345678",
    referencia: "F2026/000123",
  });
  it("por NIF, aunque venga sin guion", () => {
    expect(reconoceContraparte("RECIBO B12345678 OCTUBRE", d)).toBe("nif");
  });
  it("por número de factura", () => {
    expect(reconoceContraparte("PAGO FRA 2026-000123", d)).toBe("referencia");
  });
  it("por nombre, en mayúsculas y sin tildes", () => {
    expect(reconoceContraparte("TRANSF A INMUEBLES GARCIA LOPEZ", d)).toBe("nombre");
  });
  it("un apellido suelto no basta", () => {
    expect(reconoceContraparte("BIZUM LOPEZ", d)).toBeNull();
  });
});

describe("plan de conciliación", () => {
  it("importe + fecha + contraparte → verde", () => {
    const plan = planConciliacion(
      [mov({ id: "m", importe: -1020, concepto: "RECIBO INMUEBLES GARCIA LOPEZ" })],
      [recibida({ id: "alq", liquido: 1020, contraparte: "Inmuebles García López SL" })],
    );
    expect(plan.verdes).toEqual([
      {
        movimientos: ["m"],
        documentos: [{ tipo: "compra", id: "alq" }],
        estado: "conciliada",
        motivo: "contraparte",
        diferencia: 0,
      },
    ]);
    expect(plan.ambares).toEqual([]);
  });

  it("solo importe + fecha → ámbar, nunca verde", () => {
    const plan = planConciliacion(
      [mov({ id: "m", importe: -60.5, concepto: "COMPRA TARJETA 4589" })],
      [recibida({ id: "tinta", liquido: 60.5, contraparte: "Tintas del Norte SL" })],
    );
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toHaveLength(1);
    expect(plan.ambares[0]).toMatchObject({ estado: "revisar", motivo: "importe_fecha" });
  });

  it("un céntimo de diferencia por redondeo sigue en verde y se guarda la diferencia", () => {
    const plan = planConciliacion(
      [mov({ id: "m", importe: -40.34, concepto: "ADEUDO TINTAS DEL NORTE" })],
      [recibida({ id: "c", liquido: 40.33, contraparte: "Tintas del Norte SL" })],
    );
    expect(plan.verdes).toHaveLength(1);
    expect(plan.verdes[0].diferencia).toBe(-0.01);
  });

  it("fuera de la ventana no casa", () => {
    const plan = planConciliacion(
      [mov({ id: "m", fecha: "2027-01-20", importe: -1020, concepto: "INMUEBLES GARCIA LOPEZ" })],
      [recibida({ id: "alq", liquido: 1020, contraparte: "Inmuebles García López SL" })],
    );
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toEqual([]);
  });

  it("dos facturas iguales del mismo proveedor el mismo día → ámbar, no se elige a ciegas", () => {
    const plan = planConciliacion(
      [mov({ id: "m", importe: -49.99, concepto: "ADOBE SYSTEMS" })],
      [
        recibida({ id: "a1", liquido: 49.99, contraparte: "Adobe Systems" }),
        recibida({ id: "a2", liquido: 49.99, contraparte: "Adobe Systems" }),
      ],
    );
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toHaveLength(1);
    expect(plan.ambares[0].motivo).toBe("varias_candidatas");
  });

  it("la cuota de cada mes casa con la factura de su mes, en verde", () => {
    const plan = planConciliacion(
      [
        mov({ id: "oct", fecha: "2026-10-03", importe: -49.99, concepto: "ADOBE SYSTEMS" }),
        mov({ id: "nov", fecha: "2026-11-03", importe: -49.99, concepto: "ADOBE SYSTEMS" }),
      ],
      [
        recibida({
          id: "f-oct",
          fecha: "2026-10-01",
          liquido: 49.99,
          contraparte: "Adobe Systems",
        }),
        recibida({
          id: "f-nov",
          fecha: "2026-11-01",
          liquido: 49.99,
          contraparte: "Adobe Systems",
        }),
      ],
    );
    expect(plan.ambares).toEqual([]);
    expect(plan.verdes.map((e) => [e.movimientos[0], e.documentos[0].id])).toEqual([
      ["oct", "f-oct"],
      ["nov", "f-nov"],
    ]);
  });

  it("dos cuotas y dos facturas iguales el mismo día: caben dos repartos → ámbar", () => {
    const plan = planConciliacion(
      [
        mov({ id: "m1", importe: -49.99, concepto: "ADOBE SYSTEMS" }),
        mov({ id: "m2", importe: -49.99, concepto: "ADOBE SYSTEMS" }),
      ],
      [
        recibida({ id: "a1", liquido: 49.99, contraparte: "Adobe Systems" }),
        recibida({ id: "a2", liquido: 49.99, contraparte: "Adobe Systems" }),
      ],
    );
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toHaveLength(2);
    expect(plan.ambares.every((e) => e.motivo === "varias_candidatas")).toBe(true);
  });

  it("dos movimientos que reclaman la misma factura en verde → los dos a revisar", () => {
    const plan = planConciliacion(
      [
        mov({ id: "m1", importe: -121, concepto: "LUZ IBERDROLA" }),
        mov({ id: "m2", importe: -121, concepto: "IBERDROLA LUZ" }),
      ],
      [recibida({ id: "luz", liquido: 121, contraparte: "Iberdrola" })],
    );
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toHaveLength(1);
  });

  it("un abono casa con la factura emitida que trae su número", () => {
    const plan = planConciliacion(
      [mov({ id: "m", importe: 302.5, concepto: "TRANSF FRA 2026/0007" })],
      [emitida({ id: "f7", total: 302.5, referencia: "2026/0007" })],
    );
    expect(plan.verdes).toHaveLength(1);
    expect(plan.verdes[0].documentos).toEqual([{ tipo: "factura", id: "f7" }]);
  });

  it("un pago que cubre dos facturas → ámbar con las dos", () => {
    const plan = planConciliacion(
      [mov({ id: "m", fecha: "2026-11-10", importe: -90.75, concepto: "TINTAS DEL NORTE" })],
      [
        recibida({ id: "t1", liquido: 60.5, contraparte: "Tintas del Norte SL" }),
        recibida({ id: "t2", liquido: 30.25, contraparte: "Tintas del Norte SL" }),
        recibida({ id: "otra", liquido: 45, contraparte: "Otra SL" }),
      ],
    );
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toHaveLength(1);
    expect(plan.ambares[0]).toMatchObject({ motivo: "suma_documentos", estado: "revisar" });
    expect(plan.ambares[0].documentos.map((d) => d.id).sort()).toEqual(["t1", "t2"]);
  });

  it("una factura pagada en dos plazos → ámbar con los dos movimientos", () => {
    const plan = planConciliacion(
      [
        mov({ id: "p1", fecha: "2026-11-12", importe: -605 }),
        mov({ id: "p2", fecha: "2026-11-20", importe: -605 }),
      ],
      [recibida({ id: "maq", liquido: 1210 })],
    );
    expect(plan.ambares).toHaveLength(1);
    expect(plan.ambares[0]).toMatchObject({ motivo: "suma_movimientos", diferencia: 0 });
    expect(plan.ambares[0].movimientos.sort()).toEqual(["p1", "p2"]);
  });

  it("cada documento y cada movimiento, en un solo enlace", () => {
    const plan = planConciliacion(
      [
        mov({ id: "m1", importe: -10 }),
        mov({ id: "m2", importe: -10 }),
        mov({ id: "m3", importe: -20 }),
      ],
      [recibida({ id: "d1", liquido: 10 }), recibida({ id: "d2", liquido: 20 })],
    );
    const todos = [...plan.verdes, ...plan.ambares];
    const movsUsados = todos.flatMap((e) => e.movimientos);
    const docsUsados = todos.flatMap((e) => e.documentos.map((d) => d.id));
    expect(new Set(movsUsados).size).toBe(movsUsados.length);
    expect(new Set(docsUsados).size).toBe(docsUsados.length);
  });

  it("un traspaso entre cuentas propias se marca y no paga ninguna factura", () => {
    const plan = planConciliacion(
      [
        mov({ id: "sale", fecha: "2026-11-15", importe: -500, cuenta_id: "principal" }),
        mov({ id: "entra", fecha: "2026-11-17", importe: 500, cuenta_id: "ahorro" }),
      ],
      [recibida({ id: "d", fecha: "2026-11-14", liquido: 500 })],
    );
    expect(plan.traspasos).toEqual([{ a: "sale", b: "entra", dias: 2 }]);
    expect(plan.verdes).toEqual([]);
    expect(plan.ambares).toEqual([]);
  });
});

describe("traspasos", () => {
  it("misma cuenta, más de 3 días o importes distintos: no es traspaso", () => {
    expect(
      detectarTraspasos([
        mov({ id: "a", importe: -500, cuenta_id: "x" }),
        mov({ id: "b", importe: 500, cuenta_id: "x" }),
      ]),
    ).toEqual([]);
    expect(
      detectarTraspasos([
        mov({ id: "a", fecha: "2026-11-01", importe: -500, cuenta_id: "x" }),
        mov({ id: "b", fecha: "2026-11-05", importe: 500, cuenta_id: "y" }),
      ]),
    ).toEqual([]);
    expect(
      detectarTraspasos([
        mov({ id: "a", importe: -500, cuenta_id: "x" }),
        mov({ id: "b", importe: 500.01, cuenta_id: "y" }),
      ]),
    ).toEqual([]);
  });

  it("sin cuenta (movimientos de antes) no se adivina", () => {
    expect(
      detectarTraspasos([
        mov({ id: "a", importe: -500, cuenta_id: null }),
        mov({ id: "b", importe: 500, cuenta_id: "y" }),
      ]),
    ).toEqual([]);
  });

  it("con dos espejos posibles se queda el más cercano y el otro queda libre", () => {
    expect(
      detectarTraspasos([
        mov({ id: "a", fecha: "2026-11-10", importe: -500, cuenta_id: "x" }),
        mov({ id: "b", fecha: "2026-11-13", importe: 500, cuenta_id: "y" }),
        mov({ id: "c", fecha: "2026-11-11", importe: 500, cuenta_id: "y" }),
      ]),
    ).toEqual([{ a: "a", b: "c", dias: 1 }]);
  });
});

describe("sugerencias", () => {
  it("todas las del mismo importe, ordenadas por probabilidad, incluso fuera de fecha", () => {
    const m = mov({ id: "m", fecha: "2026-11-05", importe: -121, concepto: "IBERDROLA" });
    const docs = [
      recibida({ id: "lejos", fecha: "2026-06-01", liquido: 121, contraparte: "Gas SL" }),
      recibida({ id: "cerca", fecha: "2026-11-04", liquido: 121, contraparte: "Gas SL" }),
      recibida({ id: "iber", fecha: "2026-10-01", liquido: 121, contraparte: "Iberdrola" }),
      recibida({ id: "otro-importe", liquido: 122, contraparte: "Iberdrola" }),
      emitida({ id: "emitida", total: 121 }),
    ];
    const s = sugerencias(m, docs);
    expect(s.map((x) => x.documento.id)).toEqual(["iber", "cerca", "lejos"]);
    expect(s[0]).toMatchObject({ contraparte: "nombre", enVentana: true, dias: 35 });
    expect(s[2].enVentana).toBe(false);
  });
});
