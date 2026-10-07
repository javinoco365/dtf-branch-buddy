import { describe, expect, it } from "vitest";
import { claveCliente, clientesDormidos, resumenClientes, type VentaCliente } from "./clientela";
import { ventaDeTextil, ventaDeTienda } from "./gerencia";

const pedido = (
  cliente: string | null,
  fecha: string,
  total: number,
  extra: Partial<VentaCliente> = {},
): VentaCliente => ({
  ...ventaDeTienda({
    fecha_pedido: `${fecha}T10:00:00`,
    tienda_id: "t1",
    estado: "entregado",
    subtotal: total / 1.21,
    iva: total - total / 1.21,
    envio: 0,
    total,
    metros_total: 1,
    origen: "manual",
    cliente_id: cliente,
  }),
  cliente_nombre: cliente ? `Cliente ${cliente}` : null,
  ...extra,
});

const octubre = { desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 31, 23, 59, 59) };

describe("clientes del periodo", () => {
  const historial = [
    pedido("a", "2026-03-10", 100), // a ya compraba: recurrente
    pedido("a", "2026-10-02", 500),
    pedido("b", "2026-10-03", 300), // b, primer pedido en octubre: nuevo
    pedido("b", "2026-10-20", 100),
    pedido("c", "2026-10-05", 50),
    pedido("d", "2026-10-06", 50),
    pedido(null, "2026-10-07", 70), // sin cliente
    pedido("e", "2026-10-08", 999, { estado: "cancelado" }), // cancelado: no cuenta
  ];
  const r = resumenClientes(historial, octubre);

  it("separa nuevos y recurrentes con el historial entero", () => {
    expect(r.activos).toBe(4);
    expect(r.recurrentes).toBe(1);
    expect(r.nuevos).toBe(3);
    expect(r.vendidoRecurrentes).toBe(500);
    expect(r.vendidoNuevos).toBe(500);
    expect(r.sinCliente).toEqual({ pedidos: 1, vendido: 70 });
  });

  it("ordena el ranking por lo vendido en el periodo, con peso y acumulado", () => {
    expect(r.ranking.map((c) => c.clave)).toEqual(["a", "b", "c", "d"]);
    expect(r.ranking[0]).toMatchObject({ vendido: 500, pedidos: 1, nuevo: false, peso: 50 });
    expect(r.ranking[1]).toMatchObject({ vendido: 400, pedidos: 2, nuevo: true, acumulado: 90 });
  });

  it("80/20: cuántos clientes hacen el 80 % de lo vendido", () => {
    // 500 + 400 = 900 de 1000: con dos de cuatro clientes ya se pasa del 80 %.
    expect(r.pareto).toEqual({ clientes: 2, porcentajeClientes: 50 });
    expect(resumenClientes([], octubre).pareto).toBeNull();
  });

  it("resta las devoluciones de lo vendido a cada cliente", () => {
    const x = resumenClientes([pedido("a", "2026-10-02", 100, { devuelto: 40 })], octubre);
    expect(x.ranking[0].vendido).toBe(60);
  });

  it("el cliente textil es otra ficha aunque coincida el identificador", () => {
    const t = {
      ...ventaDeTextil({
        fecha: "2026-10-03",
        estado: "entregado",
        subtotal: 10,
        iva: 2.1,
        envio: 0,
        total: 12.1,
        cliente_id: "a",
      }),
      cliente_nombre: "Textil A",
    };
    expect(claveCliente(t)).toBe("textil:a");
    expect(resumenClientes([pedido("a", "2026-10-02", 100), t], octubre).activos).toBe(2);
  });
});

describe("clientes dormidos", () => {
  it("más de 60 días sin pedir, de más a menos comprado en toda su historia", () => {
    const hoy = new Date(2026, 9, 7, 9);
    const dormidos = clientesDormidos(
      [
        pedido("a", "2026-06-01", 100),
        pedido("a", "2026-07-01", 100), // última: 98 días
        pedido("b", "2026-05-01", 900), // 159 días
        pedido("c", "2026-09-01", 50), // 36 días: activo
        pedido("d", "2026-08-08", 50), // 60 días justos: todavía no
      ],
      hoy,
    );
    expect(dormidos.map((c) => c.clave)).toEqual(["b", "a"]);
    expect(dormidos[1]).toMatchObject({ vendido: 200, pedidos: 2, dias: 98 });
  });
});
