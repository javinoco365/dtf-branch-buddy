import { describe, expect, it } from "vitest";
import { MENU_PRINCIPAL, MENU_SISTEMA, entradaActiva, pantallaActual } from "./navegacion";

describe("pantallaActual", () => {
  it("nombra las pantallas generales con su grupo", () => {
    expect(pantallaActual("/panel")).toEqual({ seccion: null, titulo: "Inicio" });
    expect(pantallaActual("/panel/pedidos")).toEqual({ seccion: "Ventas", titulo: "Pedidos" });
    expect(pantallaActual("/panel/facturacion-global")).toEqual({
      seccion: "Dinero",
      titulo: "Lo cobrado",
    });
    expect(pantallaActual("/panel/conciliacion")).toEqual({
      seccion: "Dinero",
      titulo: "Conciliación bancaria",
    });
  });

  it("Gerencia sigue siendo Gerencia en cualquier pestaña", () => {
    expect(pantallaActual("/panel/gerencia")).toEqual({ seccion: null, titulo: "Gerencia" });
  });

  it("en una tienda, la sección es su nombre", () => {
    expect(pantallaActual("/panel/tiendas/abc/facturas", "Tienda Uno")).toEqual({
      seccion: "Tienda Uno",
      titulo: "Facturas",
    });
    expect(pantallaActual("/panel/tiendas/abc", "Tienda Uno")).toEqual({
      seccion: "Tienda Uno",
      titulo: "Resumen",
    });
  });

  it("sin el nombre de la tienda (aún cargando), dice «Tienda»", () => {
    expect(pantallaActual("/panel/tiendas/abc/pedidos")).toEqual({
      seccion: "Tienda",
      titulo: "Pedidos",
    });
    expect(pantallaActual("/panel/tiendas/abc/pedidos", "  ")?.seccion).toBe("Tienda");
  });

  it("la lista de tiendas no se confunde con una tienda", () => {
    expect(pantallaActual("/panel/tiendas")).toEqual({
      seccion: "Tiendas",
      titulo: "Gestionar tiendas",
    });
  });

  it("textil: el resumen y cada pantalla, sin que «/panel/textil» se coma las demás", () => {
    expect(pantallaActual("/panel/textil")).toEqual({ seccion: "Textil", titulo: "Resumen" });
    expect(pantallaActual("/panel/textil/stock")).toEqual({ seccion: "Textil", titulo: "Stock" });
    expect(pantallaActual("/panel/textil/presupuestos")).toEqual({
      seccion: "Textil",
      titulo: "Presupuestos",
    });
  });

  it("las subpantallas de Ajustes llevan su propio nombre", () => {
    expect(pantallaActual("/panel/configuracion")).toEqual({
      seccion: "Sistema",
      titulo: "Ajustes",
    });
    expect(pantallaActual("/panel/configuracion-pdf")).toEqual({
      seccion: "Ajustes",
      titulo: "PDF de presupuestos",
    });
  });

  it("una barra al final no cambia nada", () => {
    expect(pantallaActual("/panel/pedidos/")).toEqual(pantallaActual("/panel/pedidos"));
  });

  it("fuera del panel no hay pantalla", () => {
    expect(pantallaActual("/auth")).toBeNull();
  });
});

describe("entradaActiva", () => {
  const ajustes = MENU_SISTEMA.find((e) => e.etiqueta === "Ajustes")!;
  const inicio = MENU_PRINCIPAL[0].entradas[0];

  it("Ajustes se marca también en sus subpantallas", () => {
    expect(entradaActiva(ajustes, "/panel/configuracion-empresa")).toBe(true);
  });

  it("Inicio solo en el inicio, no en todo lo que empieza por /panel", () => {
    expect(entradaActiva(inicio, "/panel")).toBe(true);
    expect(entradaActiva(inicio, "/panel/pedidos")).toBe(false);
  });
});
