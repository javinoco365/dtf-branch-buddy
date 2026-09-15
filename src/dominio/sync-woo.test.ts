import { describe, expect, it } from "vitest";
import {
  clientesInvitadosNuevos,
  estadoPagoPorDevolucion,
  fechaMasAntigua,
  idsVistosWoo,
  pedidosDesaparecidos,
  totalReembolsado,
} from "./sync-woo";

describe("idsVistosWoo", () => {
  it("da el conjunto de ids que ha traído la página", () => {
    expect(idsVistosWoo([{ id: 432 }, { id: 430 }])).toEqual(new Set([432, 430]));
  });

  it("una página vacía da un conjunto vacío", () => {
    expect(idsVistosWoo([])).toEqual(new Set());
  });
});

describe("fechaMasAntigua", () => {
  it("coge la fecha mínima, sin fiarse del orden de la lista", () => {
    expect(
      fechaMasAntigua([
        { id: 1, date_created: "2026-09-05T10:00:00" },
        { id: 2, date_created: "2026-09-01T10:00:00" },
        { id: 3, date_created: "2026-09-03T10:00:00" },
      ]),
    ).toBe("2026-09-01T10:00:00");
  });

  it("ignora los pedidos sin fecha", () => {
    expect(fechaMasAntigua([{ id: 1, date_created: null }, { id: 2 }])).toBeNull();
  });

  it("una página vacía no tiene fecha más antigua", () => {
    expect(fechaMasAntigua([])).toBeNull();
  });
});

describe("pedidosDesaparecidos", () => {
  it("encuentra el pedido del CRM que Woo ya no trae", () => {
    // El caso que motiva la función: han borrado el 430 en WooCommerce.
    const crm = [
      { id: "a", woo_order_id: 432 },
      { id: "b", woo_order_id: 430 },
    ];
    const woo = [{ id: 432 }];
    expect(pedidosDesaparecidos(crm, woo)).toEqual([{ id: "b", woo_order_id: 430 }]);
  });

  it("no encuentra nada si todos siguen estando", () => {
    const crm = [{ id: "a", woo_order_id: 432 }];
    const woo = [{ id: 432 }, { id: 430 }];
    expect(pedidosDesaparecidos(crm, woo)).toEqual([]);
  });

  it("sin candidatos del CRM no hay nada que borrar", () => {
    expect(pedidosDesaparecidos([], [{ id: 432 }])).toEqual([]);
  });
});

describe("totalReembolsado", () => {
  it("suma los reembolsos, en positivo aunque Woo los guarde en negativo", () => {
    expect(totalReembolsado([{ total: "-3.96" }, { total: "-1.00" }])).toBeCloseTo(4.96);
  });

  it("sin reembolsos, cero", () => {
    expect(totalReembolsado([])).toBe(0);
    expect(totalReembolsado(null)).toBe(0);
    expect(totalReembolsado(undefined)).toBe(0);
  });

  it("ignora un reembolso sin importe numérico en vez de romper la suma", () => {
    expect(
      totalReembolsado([{ total: "-3.96" }, { total: null }, { total: "no es un número" }]),
    ).toBeCloseTo(3.96);
  });

  it("no se rompe si lo que llega no es un array", () => {
    expect(totalReembolsado("nada de esto")).toBe(0);
    expect(totalReembolsado({ total: "-5" })).toBe(0);
  });
});

describe("estadoPagoPorDevolucion", () => {
  it("marca reembolsado cuando lo devuelto cubre el pedido entero", () => {
    expect(estadoPagoPorDevolucion(60.5, 60.5)).toBe("reembolsado");
  });

  it("un céntimo de diferencia por redondeo no cuenta como parcial", () => {
    expect(estadoPagoPorDevolucion(60.5, 60.49)).toBe("reembolsado");
  });

  it("marca parcial cuando se ha devuelto una parte", () => {
    expect(estadoPagoPorDevolucion(100, 30)).toBe("parcial");
  });

  it("sin nada devuelto, no hay nada que cambiar", () => {
    expect(estadoPagoPorDevolucion(100, 0)).toBeNull();
  });
});

describe("clientesInvitadosNuevos", () => {
  it("da de alta al invitado que no tiene ficha todavía", () => {
    expect(
      clientesInvitadosNuevos(
        [
          {
            billing: {
              first_name: "Ana",
              last_name: "Ejemplo",
              email: "ana@example.com",
              phone: "600123456",
              city: "Huelva",
            },
          },
        ],
        new Set(),
      ),
    ).toEqual([
      {
        nombre: "Ana Ejemplo",
        email: "ana@example.com",
        telefono: "600123456",
        empresa: null,
        direccion: null,
        codigo_postal: null,
        ciudad: "Huelva",
        provincia: null,
        pais: "ES",
      },
    ]);
  });

  it("un pedido con customer_id no es un invitado, aunque venga con billing", () => {
    // Ese pedido ya se resuelve por /customers; duplicarlo aquí sería la
    // misma persona con dos fichas.
    expect(
      clientesInvitadosNuevos(
        [{ customer_id: 42, billing: { email: "registrado@example.com" } }],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("no da de alta a un correo que ya tiene ficha", () => {
    expect(
      clientesInvitadosNuevos(
        [{ billing: { email: "ya@example.com" } }],
        new Set(["ya@example.com"]),
      ),
    ).toEqual([]);
  });

  it("la comparación con las fichas existentes ignora mayúsculas", () => {
    expect(
      clientesInvitadosNuevos(
        [{ billing: { email: "Mayus@Example.com" } }],
        new Set(["mayus@example.com"]),
      ),
    ).toEqual([]);
  });

  it("dos pedidos de invitado con el mismo correo en la misma tanda dan una sola ficha", () => {
    // Si no, la segunda fila chocaría al insertar las dos en la misma escritura.
    const resultado = clientesInvitadosNuevos(
      [
        { billing: { first_name: "Ana", email: "ana@example.com" } },
        { billing: { first_name: "Ana", email: "ANA@EXAMPLE.COM" } },
      ],
      new Set(),
    );
    expect(resultado).toHaveLength(1);
  });

  it("sin correo, no hay con qué identificar al invitado: se ignora", () => {
    expect(clientesInvitadosNuevos([{ billing: { first_name: "Ana" } }], new Set())).toEqual([]);
    expect(clientesInvitadosNuevos([{}], new Set())).toEqual([]);
  });

  it("sin nombre, usa el correo tal cual, no lo deja en blanco", () => {
    expect(
      clientesInvitadosNuevos([{ billing: { email: "sinnombre@example.com" } }], new Set())[0]
        .nombre,
    ).toBe("sinnombre@example.com");
  });

  it("sin país, cae en España: es lo que asume el resto de la sincronización", () => {
    expect(
      clientesInvitadosNuevos([{ billing: { email: "ana@example.com" } }], new Set())[0].pais,
    ).toBe("ES");
  });
});
