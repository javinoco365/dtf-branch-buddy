import process from "node:process";

/**
 * Envío de correo por SMTP.
 *
 * SOLO SERVIDOR. El sufijo .server.ts impide que Vite lo meta en el bundle del
 * navegador, y eso aquí no es cosmético: nodemailer arrastra node:net y
 * node:tls, y las credenciales SMTP no pueden acercarse al cliente.
 *
 * SOBRE EL ENTORNO DE EJECUCIÓN
 *   SMTP necesita un socket TCP real. En un Worker no existe: nitro lo
 *   sustituye por los stubs de unenv, que compilan pero no conectan. En Vercel
 *   la app corre como función de Node y sí hay sockets.
 *
 *   Por eso un fallo de envío se registra siempre en pedido_correos_enviados
 *   con su motivo, en vez de perderse: si algún día el destino de despliegue
 *   cambia, se verá en el registro y no por un cliente que llama preguntando
 *   por su pedido.
 */

export type Credenciales = {
  host: string;
  puerto: number;
  usuario: string;
  clave: string;
};

/**
 * Las credenciales del entorno, si las hay.
 *
 * Ya no son la fuente principal: el servidor de correo se configura desde la
 * aplicación y la contraseña vive en Vault. Esto se queda como respaldo para
 * no romper un despliegue que ya tuviera las variables puestas, y porque
 * permite mandar correo antes de haber configurado nada.
 *
 * Para Resend: host smtp.resend.com, puerto 465, usuario "resend" y la clave
 * de API como contraseña.
 */
export function credencialesSmtp(): Credenciales | null {
  const host = process.env.SMTP_HOST;
  const usuario = process.env.SMTP_USUARIO;
  const clave = process.env.SMTP_CLAVE;
  if (!host || !usuario || !clave) return null;
  return { host, puerto: Number(process.env.SMTP_PUERTO ?? 465), usuario, clave };
}

export type Mensaje = {
  de: string;
  para: string;
  asunto: string;
  texto: string;
  html: string;
};

/**
 * Manda un correo. Devuelve el motivo del fallo en vez de lanzar.
 *
 * Quien llama tiene que poder registrar el fallo y seguir: que no salga un
 * aviso no puede tumbar el cambio de estado de un pedido.
 */
export async function enviarCorreo(
  m: Mensaje,
  credenciales?: Credenciales | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Las de la aplicación mandan; el entorno es el respaldo.
  const creds = credenciales ?? credencialesSmtp();
  if (!creds) {
    return {
      ok: false,
      error: "No hay servidor de correo configurado. Ponlo en Configuración › Servidor de correo.",
    };
  }

  try {
    // Importación dinámica: así nodemailer no entra en el grafo del cliente ni
    // en el arranque del servidor, solo cuando de verdad hay que enviar.
    const { createTransport } = await import("nodemailer");
    const transporte = createTransport({
      host: creds.host,
      port: creds.puerto,
      secure: creds.puerto === 465,
      auth: { user: creds.usuario, pass: creds.clave },
    });

    await transporte.sendMail({
      from: m.de,
      to: m.para,
      subject: m.asunto,
      text: m.texto,
      html: m.html,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * El cuerpo HTML a partir del texto plano de la plantilla.
 *
 * El texto ya viene con las variables sustituidas y escapadas por
 * renderizarPlantilla(). Aquí solo se convierten los saltos de línea, que es
 * todo el formato que este correo necesita.
 */
export function textoAHtml(texto: string): string {
  const parrafos = texto
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em">${p.replace(/\n/g, "<br />")}</p>`)
    .join("");
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#111">${parrafos}</div>`;
}
