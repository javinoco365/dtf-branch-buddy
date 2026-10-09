import { describe, expect, it } from "vitest";
import { pedidosPorEstado, type PedidoTaller } from "./produccion";
import { comparacionCompras } from "./compras";
import {
  trimestreDe,
  type Compensacion303,
  type ImpuestosTrimestre,
  type LineaCalendario,
} from "./impuestos";
import {
  totalComparacion,
  totalImpuestos,
  totalPorEstado,
  totalTaller,
} from "./sumatorios-gerencia-b";

const pedido = (estado: string, fecha: string, metros = 1, total = 10): PedidoTaller => ({
  fecha_pedido: `${fecha}T10:00:00`,
  estado,
  tienda_id: "t1",
  canal: "manual",
  metros_total: metros,
  total,
});

describe("totalTaller", () => {
  const hoy = new Date(2026, 9, 7, 18);

  it("suma pedidos, metros e importe de las filas y deja fuera lo que ya salió", () => {
    const t = totalTaller(
      [
        pedido("pendiente", "2026-10-06", 1.25, 10.1),
        pedido("pendiente", "2026-10-05", 2.5, 20.2),
        pedido("imprimiendo", "2026-09-27", 0.333, 5),
        pedido("enviado", "2026-09-01", 9, 99),
      ],
      hoy,
    );
    expect(t).toEqual({
      pedidos: 3,
      // La fila de imprimiendo pinta 0,33: el pie suma lo que se ve.
      metros: 4.08,
      importe: 35.3,
      // (1 + 2 + 10) / 3, de los pedidos y no de las medias redondeadas.
      diasMedios: 4.3,
      diasMaximo: 10,
    });
  });

  it("la media es de los pedidos, no de las filas: la fila con más pedidos pesa más", () => {
    const t = totalTaller(
      [
        pedido("pendiente", "2026-10-06"),
        pedido("pendiente", "2026-10-06"),
        pedido("pendiente", "2026-10-06"),
        pedido("listo", "2026-09-27"),
      ],
      hoy,
    );
    // (1 + 1 + 1 + 10) / 4 = 3,25; la media de las dos filas daría 5,5.
    expect(t.diasMedios).toBe(3.3);
  });

  it("sin nada en el taller, los días quedan sin valor", () => {
    expect(totalTaller([pedido("entregado", "2026-10-01")], hoy)).toEqual({
      pedidos: 0,
      metros: 0,
      importe: 0,
      diasMedios: null,
      diasMaximo: null,
    });
  });
});

describe("totalPorEstado", () => {
  it("los cancelados no suman y se cuentan aparte", () => {
    const filas = pedidosPorEstado([
      pedido("pendiente", "2026-10-01", 1),
      pedido("pendiente", "2026-10-02", 1.5),
      pedido("entregado", "2026-10-03", 3),
      pedido("cancelado", "2026-10-03", 2),
      pedido("cancelado", "2026-10-04", 2),
    ]);
    expect(totalPorEstado(filas)).toEqual({ pedidos: 3, metros: 5.5, cancelados: 2 });
  });

  it("sin cancelados, la suma de todas las filas", () => {
    const filas = pedidosPorEstado([
      pedido("listo", "2026-10-01", 0.1),
      pedido("enviado", "2026-10-01", 0.2),
    ]);
    expect(totalPorEstado(filas)).toEqual({ pedidos: 2, metros: 0.3, cancelados: 0 });
  });
});

describe("totalComparacion", () => {
  it("suma las dos filas y la diferencia cuadra con la de cada fila", () => {
    const filas = comparacionCompras(
      { consumibles: 100.1, envios: 30 },
      { produccion: 80.05, envios: 45.5 },
    );
    const t = totalComparacion(filas);
    expect(t).toEqual({ comprado: 130.1, estimado: 125.55, diferencia: 4.55 });
    expect(t.diferencia).toBe(Math.round((filas[0].diferencia + filas[1].diferencia) * 100) / 100);
  });
});

describe("totalImpuestos", () => {
  const linea = (modelo: LineaCalendario["modelo"], importe: number): LineaCalendario => ({
    modelo,
    concepto: modelo,
    importe,
    plazo: new Date(2026, 9, 20),
  });
  const trimestre = (
    mes: number,
    lineas: LineaCalendario[],
    compensacion: Partial<Compensacion303> = {},
  ): ImpuestosTrimestre => ({
    trimestre: trimestreDe(new Date(2026, mes, 1)),
    ivaRepercutido: 0,
    ivaSoportado: 0,
    irpf111: 0,
    irpf115: 0,
    lineas,
    compensacion: {
      resultado: 0,
      compensado: 0,
      aIngresar: 0,
      pendiente: 0,
      trimestresPendientes: 0,
      ...compensacion,
    },
    aPagar: Math.round(lineas.reduce((s, l) => s + Math.max(0, l.importe), 0) * 100) / 100,
  });

  it("lo que sale a compensar no resta de los otros modelos", () => {
    const t = totalImpuestos([
      trimestre(6, [linea("303", -200), linea("111", 150), linea("115", 0)], {
        resultado: -200,
        pendiente: 200,
        trimestresPendientes: 1,
      }),
      trimestre(9, [linea("303", 0), linea("111", 50), linea("202", 18)], {
        resultado: 100,
        compensado: 100,
        pendiente: 100,
        trimestresPendientes: 1,
      }),
    ]);
    // El 303 del cuarto ya llega compensado: 100 − 100 = 0, y quedan 100.
    expect(t).toEqual({
      aIngresar: 218,
      modelosAIngresar: 3,
      aCompensar: 100,
      modelosACompensar: 1,
    });
  });

  it("lo ya compensado no se cuenta como pendiente", () => {
    const t = totalImpuestos([
      trimestre(0, [linea("303", -300)], {
        resultado: -300,
        pendiente: 300,
        trimestresPendientes: 1,
      }),
      trimestre(3, [linea("303", 200)], { resultado: 500, compensado: 300, aIngresar: 200 }),
    ]);
    expect(t).toEqual({ aIngresar: 200, modelosAIngresar: 1, aCompensar: 0, modelosACompensar: 0 });
  });

  it("sin nada negativo, no hay nada a compensar", () => {
    const t = totalImpuestos([trimestre(0, [linea("303", 10), linea("111", 0)])]);
    expect(t).toEqual({ aIngresar: 10, modelosAIngresar: 1, aCompensar: 0, modelosACompensar: 0 });
  });

  it("sin trimestres, todo a cero", () => {
    expect(totalImpuestos([])).toEqual({
      aIngresar: 0,
      modelosAIngresar: 0,
      aCompensar: 0,
      modelosACompensar: 0,
    });
  });
});
