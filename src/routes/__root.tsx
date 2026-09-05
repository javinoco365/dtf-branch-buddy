import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth-context";
import { esErrorDeVersionVieja } from "@/dominio/despliegue";
import {
  intentarRecargaPorVersionVieja,
  registrarAvisosDeVersionVieja,
} from "@/lib/recarga-despliegue";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  /*
   * Un error de «versión vieja» no es un fallo de la aplicación: es que se ha
   * desplegado mientras esta pestaña estaba abierta y el código que pide ya no
   * existe en el servidor. Se recarga sola en vez de enseñar una pantalla de
   * error que no dice nada útil y que se arregla con F5.
   *
   * Se empieza pintando «Actualizando…» y la recarga se lanza en el efecto,
   * no aquí: recargar durante el renderizado es un efecto secundario en mitad
   * de React. Si la recarga no llega a salir —porque ya se intentó y el trozo
   * falta de verdad en el servidor— se pasa a la pantalla de error normal, que
   * es lo correcto: ahí sí hay algo roto.
   */
  const [recargando, setRecargando] = useState(() => esErrorDeVersionVieja(error));

  useEffect(() => {
    if (!recargando) return;
    if (!intentarRecargaPorVersionVieja(error)) setRecargando(false);
  }, [recargando, error]);

  useEffect(() => {
    if (recargando) return;
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [recargando, error]);

  if (recargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Hay una versión nueva. Actualizando…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página no ha cargado
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo ha fallado por nuestra parte. Puedes reintentar o volver al principio.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Reintentar
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Aquí seguía la plantilla de Lovable: título «Lovable App», autor
      // «Lovable», @Lovable en twitter y una og:image que era una captura del
      // editor alojada en su CDN. Al compartir un enlace del CRM, eso es lo
      // que salía en la vista previa.
      { title: "DTF Culture · CRM" },
      {
        name: "description",
        content:
          "CRM de DTF Culture: pedidos, stock, facturación y contabilidad de las tiendas de RONOCA DESARROLLOS S.L.",
      },
      { name: "author", content: "RONOCA DESARROLLOS S.L." },
      // El panel es privado: que no lo indexe nadie.
      { name: "robots", content: "noindex, nofollow" },
      // El navy de la marca: es el color de la barra del navegador en móvil.
      { name: "theme-color", content: "#2A2260" },
      { property: "og:site_name", content: "DTF Culture" },
      { property: "og:title", content: "DTF Culture · CRM" },
      {
        property: "og:description",
        content: "Gestión de pedidos, stock y facturación de DTF Culture.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "DTF Culture · CRM" },
      {
        name: "twitter:description",
        content: "Gestión de pedidos, stock y facturación de DTF Culture.",
      },
      // La vista previa al pegar un enlace en WhatsApp, Slack o un correo. El
      // logotipo sobre el navy de la marca, en 1200×630, que es lo que esperan
      // todos. Antes aquí había una captura del editor de Lovable alojada en su
      // CDN, que era lo que salía al compartir el panel.
      { property: "og:image", content: "/marca/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: "/marca/og.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/marca/favicon.png" },
      { rel: "apple-touch-icon", href: "/marca/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/*
 * El tema, antes de la primera pintura.
 *
 * Va como guion en línea dentro del <head> a propósito. Si la clase `dark` se
 * pusiera al montar un componente de React, la primera pintura sería en claro
 * y quien tenga el modo oscuro vería un fogonazo blanco en cada carga.
 *
 * Está envuelto en try/catch porque en navegación privada leer localStorage
 * puede lanzar, y un error aquí dejaría la página en blanco.
 */
const GUION_TEMA = `try{var t=localStorage.getItem('dtfculture:tema');var o=t==='oscuro'||(t!=='claro'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',o);document.documentElement.style.colorScheme=o?'dark':'light'}catch(e){}`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: GUION_TEMA }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Los fallos al traer un trozo de código no siempre llegan al límite de
  // error de React: al navegar entre secciones salen como promesa rechazada.
  useEffect(() => registrarAvisosDeVersionVieja(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
