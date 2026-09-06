import { describe, expect, it } from "vitest";
import {
  AGENCIA_NACEX_DTF_CULTURE,
  CTT_EXPRESS,
  NACEX,
  transportistaConocido,
} from "./transportistas";

describe("CTT_EXPRESS.urlSeguimiento", () => {
  it("genera el enlace desde el código", () => {
    expect(CTT_EXPRESS.urlSeguimiento("0034050034059700104370")).toBe(
      "https://www.cttexpress.com/localizador-de-envios/?sc=0034050034059700104370",
    );
  });

  it("no genera nada sin código", () => {
    expect(CTT_EXPRESS.urlSeguimiento("")).toBeNull();
    expect(CTT_EXPRESS.urlSeguimiento("   ")).toBeNull();
  });
});

describe("NACEX.urlSeguimiento", () => {
  it("separa agencia y albarán por la barra", () => {
    // El caso del ejemplo real: agencia 1220, albarán 10603971.
    expect(NACEX.urlSeguimiento("1220/10603971")).toBe(
      "https://www.nacex.es/seguimientoDetalle.do?" +
        "agencia_origen=1220&numero_albaran=10603971&estado=1&internacional=0&externo=N&usr=null&pas=null",
    );
  });

  it("usa la agencia de DTF Culture si solo llega el albarán", () => {
    expect(NACEX.urlSeguimiento("10603971")).toBe(
      `https://www.nacex.es/seguimientoDetalle.do?agencia_origen=${AGENCIA_NACEX_DTF_CULTURE}` +
        "&numero_albaran=10603971&estado=1&internacional=0&externo=N&usr=null&pas=null",
    );
  });

  it("recorta espacios sueltos alrededor de la barra", () => {
    expect(NACEX.urlSeguimiento(" 2111 / 10603971 ")).toBe(
      "https://www.nacex.es/seguimientoDetalle.do?" +
        "agencia_origen=2111&numero_albaran=10603971&estado=1&internacional=0&externo=N&usr=null&pas=null",
    );
  });

  it("no genera nada sin ningún número", () => {
    expect(NACEX.urlSeguimiento("")).toBeNull();
    expect(NACEX.urlSeguimiento("   ")).toBeNull();
    expect(NACEX.urlSeguimiento("/")).toBeNull();
  });
});

describe("transportistaConocido", () => {
  it("encuentra CTT Express y Nacex por su nombre, sin mayúsculas ni espacios", () => {
    expect(transportistaConocido("CTT Express")).toBe(CTT_EXPRESS);
    expect(transportistaConocido("nacex")).toBe(NACEX);
    expect(transportistaConocido("  Nacex  ")).toBe(NACEX);
  });

  it("no encuentra un transportista escrito a mano", () => {
    expect(transportistaConocido("SEUR")).toBeNull();
    expect(transportistaConocido("")).toBeNull();
  });
});
