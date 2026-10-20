/**
 * Lee una factura de compra con un modelo de lenguaje (visión).
 *
 * Solo servidor. La clave de API es un secreto y no puede acabar en el bundle
 * del navegador, así que este módulo se importa dinámicamente dentro del
 * handler, nunca en el nivel superior de un `*.functions.ts`.
 *
 * Se pide salida estructurada: la API obliga al modelo a devolver un JSON con
 * la forma de `ESQUEMA_LECTURA_JSON`. Aun así, lo que devuelve NO es un dato
 * bueno: es una propuesta. Quien lo valida es `validarLectura` (dominio) y
 * quien lo confirma, la persona que revisa la cola.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ESQUEMA_LECTURA_JSON } from "@/dominio/cola-compras";
import { CATEGORIAS_COMPRA } from "@/dominio/compras";

const MODELO = process.env.MODELO_LECTURA ?? "claude-opus-5-5";
const MAXIMO_BYTES = 10 * 1024 * 1024;

const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type TipoImagen = (typeof TIPOS_IMAGEN)[number];
const esImagen = (t: string): t is TipoImagen => (TIPOS_IMAGEN as readonly string[]).includes(t);

const INSTRUCCIONES = `Eres un lector de documentos de compra (facturas y proformas) de una empresa española de impresión DTF y textil.

Devuelve los datos del documento con el esquema que se te pide. Cuando un dato no aparece, escribe un texto vacío ("").

- proveedor: razón social de quien EMITE la factura (no de quien la recibe).
- nif_proveedor: su NIF o CIF.
- numero: número del documento (el de la proforma, si es una proforma).
- tipo_documento: "proforma" si el papel dice Proforma, Factura proforma, Pro-forma, Presupuesto/Pedido con pago por adelantado u Order confirmation; "factura" si es una factura (ordinaria o simplificada); si no está claro, "" y dilo en dudas.
- referencia_proforma: si es una factura que cita una proforma o un pedido anterior, ese número; si no, "".
- fecha: fecha de emisión, tal como aparece.
- concepto: en pocas palabras, qué se compra.
- categoria: una de ${CATEGORIAS_COMPRA.map((c) => `"${c.valor}" (${c.etiqueta})`).join(", ")}. Si no está claro, "".
- base, iva, irpf, total: base imponible, cuota de IVA, retención de IRPF y total a pagar.
- lineas: cada línea del papel (o cada talla, si una línea trae varias y se parte) con su tipo, cantidad, unidad, precio unitario, importe y los datos de la prenda.
- confianza: de 0 a 1, cuánto te fías de tu lectura en conjunto.
- dudas: cada cosa que no esté clara (un número borroso, un dato que no aparece, dos tipos de IVA…), en castellano y en una frase. Si no hay, una lista vacía.

En cada línea, además:
- tipo: "articulo" si es una prenda o un producto que entra en el almacén; "porte" si son portes, transporte o gastos de envío; "descuento" si es un descuento, un rappel o un abono (con importe negativo); "otro" para cualquier otro cargo (embalaje, seguro, recargo, gastos de gestión).
- referencia: el código del artículo tal como lo escribe el proveedor (referencia, código, SKU). Si no hay, "".
- marca: la marca de la prenda (Gildan, B&C, Stanley/Stella, Roly, Fruit of the Loom…), no la del proveedor. Si no aparece, "".
- modelo: el nombre del modelo de la prenda (por ejemplo «Heavy Cotton» o «Exact 190»), sin color ni talla. Si no aparece, "".
- color y talla: tal como aparecen en esa línea. Si la línea no los dice, ""; no los deduzcas de otras líneas.
- ean: el código de barras (EAN o GTIN, de 8 a 14 cifras) si la línea lo trae; si no, "".
- unidades_por_pack: si la línea vende packs, cajas o lotes («pack 5», «caja de 10»), cuántas prendas lleva cada uno, tal como está escrito; si se vende por unidades, "".
- Si una línea del papel trae varias tallas (por ejemplo «S:2 M:3 L:1» o una tabla de tallas en la misma línea), pártela en una línea por prenda, color y talla, con su cantidad, su precio unitario (el de esa talla si el papel lo distingue; si no, el de la línea) y su importe. Las partidas de una línea tienen que sumar EXACTAMENTE el importe de esa línea del papel: si el redondeo no cuadra, ajusta el céntimo en la última partida. En cada partida, linea_papel es el número (1, 2, 3…) de la línea del papel de la que sale. Si el papel no dice cuántas unidades van de cada talla, NO la partas: déjala como está, con linea_papel "", y dilo en dudas. No juntes líneas distintas del papel.
- linea_papel: "" en las líneas que no se parten.
- importe_linea_papel: en cada partida, el importe de la línea del papel de la que sale, tal cual está escrito (el mismo en todas las partidas de esa línea); "" en las líneas que no se parten.

Reglas:
- Copia los importes TAL CUAL están escritos, con su coma decimal si la tienen.
  No los conviertas ni los recalcules, salvo el importe de cada partida cuando
  partes una línea por tallas (cantidad × precio de esa talla, con el céntimo
  ajustado en la última); importe_linea_papel sí va tal cual.
- Si un dato no aparece en el documento, pon "" y dilo en dudas. NO lo
  deduzcas ni lo inventes: un hueco se rellena a mano, un dato inventado no se
  detecta.
- Los descuentos, portes y recargos van como líneas más, con su importe y su
  signo.`;

// La clave del Vault se guarda unos minutos para no pedirla en cada factura.
const MINUTOS_CACHE = 10;
let claveVault: { valor: string | null; hasta: number } | null = null;

/**
 * La clave de la API: la variable ANTHROPIC_API_KEY del despliegue si está
 * puesta y, si no, el secreto «facturas_key» del Vault de Supabase (lo lee
 * el rol de servicio; ni el navegador ni un usuario pueden).
 */
export async function claveLector(): Promise<string | null> {
  const delEntorno = process.env.ANTHROPIC_API_KEY ?? process.env.FACTURAS_KEY;
  if (delEntorno) return delEntorno;
  if (claveVault && claveVault.hasta > Date.now()) return claveVault.valor;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any).rpc("clave_lector_facturas");
  // Sin la migración 20261018100000, la función no existe: no hay clave.
  const valor = !error && typeof data === "string" && data.trim() !== "" ? data.trim() : null;
  // Si no la encuentra, vuelve a mirar enseguida: acaban de ponerla, quizá.
  claveVault = { valor, hasta: Date.now() + (valor ? MINUTOS_CACHE * 60_000 : 30_000) };
  return valor;
}

export async function hayLectorConfigurado(): Promise<boolean> {
  return (await claveLector()) !== null;
}

/**
 * Manda el fichero al modelo y devuelve lo que ha leído, sin tocar: un objeto
 * que hay que validar con `validarLectura` antes de usarlo.
 *
 * La normalización, la validación y la revisión de la aritmética viven en el
 * dominio, no aquí: así se pueden probar sin red.
 */
export async function leerFactura(bytes: Uint8Array, tipoMime: string): Promise<unknown> {
  const clave = await claveLector();
  if (!clave) {
    throw new Error(
      "Falta la clave del lector: el secreto «facturas_key» en el Vault de Supabase. " +
        "Mientras tanto, la compra se puede dar de alta a mano.",
    );
  }
  if (tipoMime !== "application/pdf" && !esImagen(tipoMime)) {
    throw new Error(`Formato no admitido (${tipoMime}). Sube un PDF, un JPG o un PNG.`);
  }
  if (bytes.byteLength > MAXIMO_BYTES) {
    throw new Error("El fichero pesa más de 10 MB. Baja la resolución o divide el PDF.");
  }

  const datos = Buffer.from(bytes).toString("base64");
  const contenido: Anthropic.Beta.BetaContentBlockParam = esImagen(tipoMime)
    ? { type: "image", source: { type: "base64", media_type: tipoMime, data: datos } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: datos } };

  const cliente = new Anthropic({ apiKey: clave });
  let respuesta: Anthropic.Beta.BetaMessage;
  try {
    respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      // Si el modelo declina por seguridad, la API repite la petición con otro.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: INSTRUCCIONES,
      output_config: {
        // Leer bien los números importa más que la velocidad.
        effort: "medium",
        format: {
          type: "json_schema",
          schema: ESQUEMA_LECTURA_JSON as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            contenido,
            { type: "text", text: "Lee este documento de compra (factura o proforma)." },
          ],
        },
      ],
    });
  } catch (e) {
    // El cuerpo del error puede traer la petición entera. Solo el código.
    if (e instanceof Anthropic.APIError) {
      throw new Error(`El lector de facturas ha respondido ${e.status ?? "sin código"}.`);
    }
    throw new Error("No se ha podido llegar al lector de facturas.");
  }

  if (respuesta.stop_reason === "refusal") {
    throw new Error("El lector de facturas se ha negado a leer este documento.");
  }
  if (respuesta.stop_reason === "max_tokens") {
    throw new Error("La factura es demasiado larga para leerla de una vez.");
  }
  const texto = respuesta.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("El lector ha devuelto algo que no es JSON.");
  }
}
