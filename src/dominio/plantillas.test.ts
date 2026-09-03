import { describe, expect, it } from "vitest";
import { renderizarPlantilla, variablesUsadas } from "./plantillas";

describe("renderizarPlantilla", () => {
  it("sustituye las variables conocidas", () => {
    const r = renderizarPlantilla(
      "Hola {{cliente_nombre}}, tu pedido {{pedido_numero}} ha salido",
      {
        cliente_nombre: "Javier",
        pedido_numero: "MAN-001",
      },
    );
    expect(r.texto).toBe("Hola Javier, tu pedido MAN-001 ha salido");
    expect(r.desconocidas).toEqual([]);
  });

  it("admite espacios dentro de las llaves", () => {
    expect(renderizarPlantilla("{{ cliente_nombre }}", { cliente_nombre: "Ana" }).texto).toBe(
      "Ana",
    );
  });

  it("deja intacta una variable que no existe, y avisa", () => {
    const r = renderizarPlantilla("Hola {{clietne_nombre}}", { cliente_nombre: "Javier" });
    // Se deja tal cual a propósito: borrarla en silencio es no enterarse nunca
    // de la errata.
    expect(r.texto).toBe("Hola {{clietne_nombre}}");
    expect(r.desconocidas).toEqual(["clietne_nombre"]);
  });

  it("distingue una variable inexistente de una sin valor", () => {
    const r = renderizarPlantilla("{{seguimiento_url}}|{{inventada}}", {
      seguimiento_url: null,
    });
    expect(r.texto).toBe("|{{inventada}}");
    expect(r.vacias).toEqual(["seguimiento_url"]);
    expect(r.desconocidas).toEqual(["inventada"]);
  });

  it("trata una cadena de espacios como vacía", () => {
    const r = renderizarPlantilla("[{{transportista}}]", { transportista: "   " });
    expect(r.texto).toBe("[]");
    expect(r.vacias).toEqual(["transportista"]);
  });

  it("escapa el HTML del valor cuando se le pide", () => {
    // Un cliente que se llame así no puede romper la maqueta del correo.
    const r = renderizarPlantilla(
      "<p>Hola {{cliente_nombre}}</p>",
      {
        cliente_nombre: '<script>alert("x")</script> & Cía',
      },
      { escaparHtml: true },
    );
    expect(r.texto).toBe("<p>Hola &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Cía</p>");
  });

  it("no escapa en el cuerpo de texto plano", () => {
    const r = renderizarPlantilla("Hola {{cliente_nombre}}", { cliente_nombre: "Martí & Hijos" });
    expect(r.texto).toBe("Hola Martí & Hijos");
  });

  it("sustituye todas las apariciones de la misma variable", () => {
    const r = renderizarPlantilla("{{a}} y {{a}}", { a: "x" });
    expect(r.texto).toBe("x y x");
  });

  it("admite números", () => {
    expect(renderizarPlantilla("{{total}} €", { total: 63.53 }).texto).toBe("63.53 €");
  });

  it("no toca una llave suelta", () => {
    expect(renderizarPlantilla("{esto} no es variable", {}).texto).toBe("{esto} no es variable");
  });
});

describe("variablesUsadas", () => {
  it("lista las variables sin repetir", () => {
    expect(variablesUsadas("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("devuelve vacío si no hay ninguna", () => {
    expect(variablesUsadas("texto sin variables")).toEqual([]);
  });
});
