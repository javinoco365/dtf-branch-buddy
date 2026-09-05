import { describe, expect, it } from "vitest";
import { porSocioInversion, totalesInversion, type ApunteInversion } from "./inversion";

const LIBRO: ApunteInversion[] = [
  { socio_nombre: "Javi C", tipo: "aportacion", importe: 5000 },
  { socio_nombre: "Javi N", tipo: "aportacion", importe: 3000 },
  { socio_nombre: "Álvaro", tipo: "aportacion", importe: 2000 },
  { socio_nombre: "Javi C", tipo: "retirada", importe: 1200 },
  { socio_nombre: "Álvaro", tipo: "retirada", importe: 500 },
];

describe("totalesInversion", () => {
  it("suma lo puesto, lo sacado y lo que queda dentro", () => {
    expect(totalesInversion(LIBRO)).toEqual({
      aportado: 10000,
      recuperado: 1700,
      pendiente: 8300,
    });
  });

  it("un libro vacío da ceros, no NaN", () => {
    expect(totalesInversion([])).toEqual({ aportado: 0, recuperado: 0, pendiente: 0 });
  });

  it("no arrastra el error binario de la suma", () => {
    const centimos: ApunteInversion[] = Array.from({ length: 10 }, () => ({
      socio_nombre: "Javi C",
      tipo: "aportacion" as const,
      importe: 0.1,
    }));
    expect(totalesInversion(centimos).aportado).toBe(1);
  });

  it("ignora los importes que no son números positivos", () => {
    expect(
      totalesInversion([
        { socio_nombre: "A", tipo: "retirada", importe: -50 },
        { socio_nombre: "A", tipo: "aportacion", importe: Number.NaN },
        { socio_nombre: "A", tipo: "aportacion", importe: 100 },
      ]),
    ).toEqual({ aportado: 100, recuperado: 0, pendiente: 100 });
  });
});

describe("porSocioInversion", () => {
  it("da una línea por socio, del que más puso al que menos", () => {
    expect(porSocioInversion(LIBRO)).toEqual([
      {
        socio: "Javi C",
        aportado: 5000,
        recuperado: 1200,
        pendiente: 3800,
        porcentaje: 50,
        apuntes: 2,
      },
      {
        socio: "Javi N",
        aportado: 3000,
        recuperado: 0,
        pendiente: 3000,
        porcentaje: 30,
        apuntes: 1,
      },
      {
        socio: "Álvaro",
        aportado: 2000,
        recuperado: 500,
        pendiente: 1500,
        porcentaje: 20,
        apuntes: 2,
      },
    ]);
  });

  it("el porcentaje va sobre lo aportado, no sobre lo pendiente", () => {
    // Javi C recupera casi todo lo suyo. Su parte del capital no cambia por
    // eso: se pactó con lo que cada uno metió.
    const r = porSocioInversion([
      { socio_nombre: "Javi C", tipo: "aportacion", importe: 5000 },
      { socio_nombre: "Javi C", tipo: "retirada", importe: 4900 },
      { socio_nombre: "Javi N", tipo: "aportacion", importe: 5000 },
    ]);
    expect(r.map((s) => [s.socio, s.porcentaje])).toEqual([
      ["Javi C", 50],
      ["Javi N", 50],
    ]);
  });

  it("un socio que ha sacado más de lo que puso queda en negativo", () => {
    // No se redondea a cero: es justo el dato por el que se mira la pantalla.
    const [javi] = porSocioInversion([
      { socio_nombre: "Javi C", tipo: "aportacion", importe: 1000 },
      { socio_nombre: "Javi C", tipo: "retirada", importe: 1500 },
    ]);
    expect(javi.pendiente).toBe(-500);
  });

  it("sin nada aportado, el porcentaje es 0 y no una división por cero", () => {
    const [solo] = porSocioInversion([{ socio_nombre: "Javi C", tipo: "retirada", importe: 300 }]);
    expect(solo).toEqual({
      socio: "Javi C",
      aportado: 0,
      recuperado: 300,
      pendiente: -300,
      porcentaje: 0,
      apuntes: 1,
    });
  });

  it("un apunte sin socio se agrupa aparte en vez de desaparecer", () => {
    // La base lo impide, pero si llegara, un euro del que no se sabe de quién
    // es sigue descuadrando la suma.
    const r = porSocioInversion([{ tipo: "aportacion", importe: 100 }]);
    expect(r[0].socio).toBe("Sin socio");
    expect(r[0].aportado).toBe(100);
  });

  it("un libro vacío no da filas", () => {
    expect(porSocioInversion([])).toEqual([]);
  });
});
