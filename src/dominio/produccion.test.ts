import { describe, expect, it } from "vitest";
import {
  diasHastaEnvio,
  pedidosPorEstado,
  tiemposEnvio,
  trabajoAbierto,
  type EnvioPedido,
  type PedidoTaller,
} from "./produccion";

const pedido = (estado: string, fecha: string, metros = 1, total = 10): PedidoTaller => ({
  fecha_pedido: `${fecha}T10:00:00`,
  estado,
  tienda_id: "t1",
  canal: "manual",
  metros_total: metros,
  total,
});

describe("pedidos por estado", () => {
  it("cuenta, suma metros e importe y ordena como el proceso", () => {
    const f = pedidosPorEstado([
      pedido("enviado", "2026-10-01", 2),
      pedido("pendiente", "2026-10-02", 1.5),
      pedido("enviado", "2026-10-03", 3),
    ]);
    expect(f.map((x) => x.estado)).toEqual(["pendiente", "enviado"]);
    expect(f[1]).toMatchObject({ etiqueta: "Enviado", pedidos: 2, metros: 5, importe: 20 });
  });
});

describe("trabajo abierto", () => {
  it("los cuatro estados abiertos, con lo que llevan esperando", () => {
    const hoy = new Date(2026, 9, 7, 18);
    const t = trabajoAbierto(
      [
        pedido("pendiente", "2026-10-01"),
        pedido("pendiente", "2026-10-05"),
        pedido("listo", "2026-10-06"),
        pedido("enviado", "2026-09-01"),
      ],
      hoy,
    );
    expect(t.map((x) => x.estado)).toEqual(["pendiente", "en_produccion", "imprimiendo", "listo"]);
    expect(t[0]).toMatchObject({ pedidos: 2, diasMedios: 4, diasMaximo: 6 });
    expect(t[1]).toMatchObject({ pedidos: 0, diasMedios: 0, diasMaximo: 0 });
    expect(t[3]).toMatchObject({ pedidos: 1, diasMaximo: 1 });
  });
});

describe("tiempos de envío", () => {
  const envio = (pedido: string, enviado: string): EnvioPedido => ({
    fecha_pedido: pedido,
    enviado_en: enviado,
    tienda_id: "t1",
    canal: "web",
  });

  it("días naturales del pedido al seguimiento, por día local", () => {
    expect(diasHastaEnvio(envio("2026-10-01T22:30:00", "2026-10-02T08:00:00"))).toBe(1);
    expect(diasHastaEnvio(envio("2026-10-01T10:00:00", "2026-10-01T18:00:00"))).toBe(0);
  });

  it("media, mediana y tramos", () => {
    const t = tiemposEnvio([
      envio("2026-10-01T10:00:00", "2026-10-01T18:00:00"), // 0
      envio("2026-10-01T10:00:00", "2026-10-03T10:00:00"), // 2
      envio("2026-10-01T10:00:00", "2026-10-04T10:00:00"), // 3
      envio("2026-10-01T10:00:00", "2026-10-11T10:00:00"), // 10
    ]);
    expect(t).toMatchObject({ envios: 4, media: 3.8, mediana: 2.5 });
    expect(t!.tramos.map((x) => x.envios)).toEqual([1, 2, 0, 1]);
    expect(tiemposEnvio([])).toBeNull();
  });
});
