/**
 * Lee una factura de compra con un modelo de lenguaje.
 *
 * Solo servidor. La clave de API es un secreto y no puede acabar en el bundle
 * del navegador, así que este módulo se importa dinámicamente dentro del
 * handler, nunca en el nivel superior de un `*.functions.ts`.
 *
 * No usa SDK a propósito: es una llamada HTTP y un `fetch` no arrastra un
 * paquete más ni obliga a seguir sus versiones.
 *
 * Lo que devuelve NO es un dato bueno: es una propuesta. Quien decide si entra
 * en el stock es la persona que revisa la pantalla. Ver `src/dominio/
 * factura-compra.ts`, que comprueba la aritmética antes de enseñarla.
 */

const MODELO = process.env.MODELO_LECTURA ?? "claude-sonnet-5";
const MAXIMO_BYTES = 10 * 1024 * 1024;

const TIPOS_ACEPTADOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const INSTRUCCIONES = `Eres un lector de facturas de compra de una empresa española de textil.

Devuelve SOLO un objeto JSON, sin explicación y sin bloque de código, con esta forma:

{
  "proveedor": "razón social de quien EMITE la factura",
  "nif_proveedor": "su NIF o CIF",
  "numero": "número de la factura",
  "fecha": "fecha de emisión",
  "base": "base imponible total",
  "iva": "cuota de IVA total",
  "total": "total de la factura",
  "lineas": [
    {
      "descripcion": "el concepto tal cual aparece",
      "cantidad": "unidades",
      "unidad": "ud, m, cajas… si aparece",
      "precio_unitario": "precio por unidad",
      "importe": "importe de la línea"
    }
  ]
}

Reglas:
- Copia los números TAL CUAL están escritos, con su coma decimal si la tienen.
  No los conviertas ni los recalcules.
- Si un dato no aparece en el documento, pon null. NO lo deduzcas ni lo
  inventes: un hueco se rellena a mano, un dato inventado no se detecta.
- El proveedor es quien emite la factura, no quien la recibe.
- Los descuentos, portes y recargos van como líneas más, con su importe y su
  signo.`;

export type LecturaBruta = Record<string, unknown>;

export function hayLectorConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Manda el fichero al modelo y devuelve lo que ha leído, sin tocar.
 *
 * La normalización y la revisión de la aritmética viven en el dominio, no
 * aquí: así se pueden probar sin red.
 */
export async function leerFactura(bytes: Uint8Array, tipoMime: string): Promise<LecturaBruta> {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) {
    throw new Error(
      "Falta ANTHROPIC_API_KEY. Configúrala en el entorno del despliegue para " +
        "poder leer facturas; mientras tanto, la compra se puede dar de alta a mano.",
    );
  }
  if (!TIPOS_ACEPTADOS.has(tipoMime)) {
    throw new Error(`Formato no admitido (${tipoMime}). Sube un PDF, un JPG o un PNG.`);
  }
  if (bytes.byteLength > MAXIMO_BYTES) {
    throw new Error("El fichero pesa más de 10 MB. Baja la resolución o divide el PDF.");
  }

  const datos = base64(bytes);
  const contenido =
    tipoMime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: tipoMime, data: datos } }
      : { type: "image", source: { type: "base64", media_type: tipoMime, data: datos } };

  const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": clave,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 4096,
      system: INSTRUCCIONES,
      messages: [
        {
          role: "user",
          content: [contenido, { type: "text", text: "Lee esta factura de compra." }],
        },
      ],
    }),
  });

  if (!respuesta.ok) {
    // El cuerpo del error puede traer la petición entera. Solo el código.
    throw new Error(
      `El lector de facturas ha respondido ${respuesta.status}. Inténtalo de nuevo o ` +
        "da la compra de alta a mano.",
    );
  }

  const json = (await respuesta.json()) as {
    content?: { type: string; text?: string }[];
  };
  const texto = (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  return extraerJson(texto);
}

/**
 * Saca el objeto JSON de la respuesta.
 *
 * Se pide sin envoltorio, pero un modelo puede devolverlo dentro de un bloque
 * de código o con una frase delante. Cazar el primer `{` hasta el último `}`
 * es más robusto que confiar en que obedezca.
 */
function extraerJson(texto: string): LecturaBruta {
  const desde = texto.indexOf("{");
  const hasta = texto.lastIndexOf("}");
  if (desde === -1 || hasta <= desde) {
    throw new Error("El lector no ha devuelto nada aprovechable. Prueba con otra imagen.");
  }
  try {
    return JSON.parse(texto.slice(desde, hasta + 1)) as LecturaBruta;
  } catch {
    throw new Error("El lector ha devuelto algo que no se puede leer. Vuelve a intentarlo.");
  }
}

function base64(bytes: Uint8Array): string {
  // Buffer existe en el servidor de Node de Vercel; el troceado evita reventar
  // la pila con ficheros grandes si hubiera que caer al camino de abajo.
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binario = "";
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}
