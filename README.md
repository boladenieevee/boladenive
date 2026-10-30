# Snowball 🍿

App de streaming de anime con estética Apple Music. Catálogo con temporadas y
episodios, reproductor MP4/HLS, "continuar viendo", favoritos, comentarios y
login con Google. Los datos de usuario viven en Supabase; el catálogo es un
archivo estático, así que la web funciona incluso abierta con doble clic.

---

## 1. Estructura

```
index.html            Interfaz completa (vistas, reproductor, modales)
catalog.json          Catálogo remoto (se sube a un hosting; la app lo descarga)
css/styles.css        Sistema de diseño
js/config.js          Credenciales de Supabase y tiempos del reproductor
js/data/catalog.js    Catálogo: animes → temporadas → episodios
js/data/PLANTILLA-anime.js  Ejemplo para copiar y pegar (no se carga)
js/app.js             Router, auth, favoritos, progreso, comentarios, player
manifest.webmanifest  Datos de la PWA (nombre, iconos, pantalla completa)
sw.js                 Service worker: abre la app sin conexión
icons/                Iconos 192/512 y apple-touch-icon
sql/schema.sql        Tablas + RLS + perfil automático (ejecutar en Supabase)
sql/migration-avatares.sql  Añade la foto de perfil (solo si ya tenías las tablas)
serve.ps1             Servidor local para probar (Windows, sin instalar nada)
```

No hay build ni dependencias que instalar. Los scripts son "clásicos" (sin
módulos ES) para que `index.html` funcione también desde `file://`.

---

## 2. Puesta en marcha

### 2.1 Crear el proyecto en Supabase

1. Entra en <https://supabase.com> → **New project**.
2. Copia la **Project URL** y la **publishable / anon key** desde
   *Project Settings → API*.
3. Pégalas en `js/config.js`:

```js
supabaseUrl: 'https://TU-PROYECTO.supabase.co',
supabaseKey: 'sb_publishable_...'
```

> La clave publishable/anon es pública por diseño. La seguridad real está en
> las políticas RLS de `sql/schema.sql`. **Nunca** pongas la `service_role`
> en el navegador.

### 2.2 Crear las tablas

En Supabase: **SQL Editor → New query**, pega el contenido completo de
`sql/schema.sql` y pulsa **Run**. Es idempotente, puedes repetirlo.

> **¿Ya tenías las tablas creadas?** Ejecuta una sola vez
> `sql/migration-avatares.sql` para añadir la foto de perfil de Google y que
> aparezca en los comentarios.

Esto crea:

| Tabla       | Para qué                                        |
|-------------|-------------------------------------------------|
| `profiles`  | Nombre público y foto del usuario               |
| `favorites` | "Mi lista"                                      |
| `progress`  | Minuto exacto por episodio (continuar viendo)   |
| `comments`  | Comentarios por anime                           |

Además activa RLS, crea los índices y añade un trigger que genera el perfil
automáticamente al registrarse (así se puede comentar justo tras el login).

### 2.3 Activar Google

1. **Google Cloud Console** → *APIs & Services → OAuth consent screen*
   (tipo *External*, añade tu dominio y tu correo).
2. *Credentials → Create credentials → OAuth client ID → Web application*.
3. En **Authorized redirect URIs** añade exactamente:

```
https://TU-PROYECTO.supabase.co/auth/v1/callback
```

4. Copia **Client ID** y **Client secret** en Supabase:
   *Authentication → Providers → Google* → activa y pega ambos.

### 2.4 URLs permitidas (redirect allowlist)

En Supabase: *Authentication → URL Configuration*.

- **Site URL**: la URL real de producción, por ejemplo
  `https://snowball.app/`
- **Redirect URLs**, una por línea:

```
https://snowball.app/**
https://www.snowball.app/**
https://tu-preview.vercel.app/**
http://localhost:5500/**
http://127.0.0.1:5500/**
```

Si falta la URL, Google devuelve al usuario al Site URL o falla el login con
`redirect_uri_mismatch`.

---

## 3. Probar en local

Google **no funciona con `file://`** (no hay origen válido para OAuth). Para
probar el login necesitas un servidor local. Incluido:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Abre <http://localhost:5500>. Si el puerto está ocupado:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080
```

Alternativas si prefieres otra cosa: `npx serve .`, la extensión *Live Server*
de VS Code, o cualquier hosting estático.

Sin servidor (doble clic en `index.html`) la app funciona en **modo invitado**:
catálogo, reproducción, favoritos y progreso en `localStorage`. Al iniciar
sesión, esos datos se suben automáticamente a la cuenta y se limpian del
navegador.

---

## 4. Catálogo: añadir animes y episodios

Todo el contenido vive en `js/data/catalog.js`, en el array `CATALOG`. No hay
base de datos de por medio: es un archivo estático, así que los cambios se ven
al recargar (con **Ctrl + F5** para saltarte la caché).

**Para añadir un anime:** abre `js/data/catalog.js`, copia el objeto de
`js/data/PLANTILLA-anime.js` y pégalo justo antes del `];` final del array.
Ese archivo de plantilla **no está enlazado** en `index.html`: es solo una
referencia para copiar y pegar.

### 4.1 Ficha del anime

```js
{
    id: 'demon-slayer',              // único, minúsculas y guiones (va en la URL)
    title: 'Demon Slayer',
    originalTitle: 'Kimetsu no Yaiba',
    year: 2019,
    genres: ['Acción', 'Fantasía'],
    studio: 'ufotable',
    status: 'En emisión',
    rating: 8.7,
    ageRating: '16+',
    synopsis: '...',
    poster: 'https://.../poster.jpg', // vertical/cuadrada, se ve en tarjetas
    banner: 'https://.../banner.jpg', // horizontal, fondo y reproductor
    featured: true,                   // tarjeta grande de Inicio
    trending: true,                   // "Top de la semana"
    seasons: [ /* ... */ ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `id` | sí | Único en todo el catálogo. Sin espacios ni mayúsculas. |
| `title`, `synopsis` | sí | Texto plano. |
| `poster`, `banner` | sí | URL `https://` de imagen. |
| `year`, `genres`, `studio`, `status`, `rating`, `ageRating` | no | Se muestran en la ficha si existen. |
| `featured`, `trending` | no | Colocan el anime en los estantes de Inicio. |

### 4.2 Temporadas y episodios

Lo más rápido es `makeSeason()`, que genera los ids solo:

```js
seasons: [
    makeSeason('demon-slayer', 1, 2019, [
        'Crueldad',                       // episodio 1 (id: demon-slayer-s1e01)
        'Sakonji Urokodaki, el entrenador',
        'Sabito y Makomo'
    ]),
    makeSeason('demon-slayer', 2, 2021, [
        { title: 'El pilar del sonido', sources: [
            { type: 'embed', url: 'https://player-ejemplo.com/e/ds-2x01' }
        ]},
        'Infiltración en el distrito'
    ], { title: 'Temporada 2 · Distrito del Entretenimiento' })
]
```

Cada posición del array puede ser:

- un **string** → título del episodio, con vídeo de demostración;
- un **objeto** → `{ title, sources, minutes, duration, thumb }` con control
  total (es lo que usarás con los embeds reales).

Campos del episodio:

```js
{
    id: 'mi-anime-s1e01',       // lo genera makeSeason; no lo escribas a mano
    number: 1,
    title: 'El final del viaje',
    duration: 1560,             // segundos (si no, minutes × 60)
    thumb: 'https://.../thumb.jpg', // opcional
    sources: [
        { type: 'embed', url: 'https://player-ejemplo.com/e/abc' }
    ]
}
```

### 4.3 Reproductores externos (`embed`)

El reproductor pinta la URL en un `<iframe>` a pantalla completa dentro de la
app. Reglas prácticas:

1. Usa la **URL de embed/iframe** que da el proveedor, no la de la página
   donde se ve el capítulo. En YouTube, por ejemplo, es
   `https://www.youtube.com/embed/ID`, no `watch?v=ID`.
2. Debe ser `https://`.
3. El sitio tiene que **permitir iframes**. Si al abrir el episodio ves el
   marco vacío o "refused to connect", ese host lo bloquea (`X-Frame-Options`
   o CSP): prueba otro servidor o mirror.
4. Si el host exige un `Referer` concreto o lo bloquea, añade
   `referrerPolicy: 'no-referrer'` a la fuente.
5. **Solo se usa la primera fuente** de `sources`. Deja delante la más estable.
6. Con `embed` no hay progreso real, reanudación ni "siguiente episodio"
   automático: la app no puede leer el estado del reproductor ajeno. Eso solo
   funciona con `mp4`/`hls`.

```js
sources: [
    { type: 'embed', url: 'https://player-ejemplo.com/e/abc', referrerPolicy: 'no-referrer' }
]
```

### 4.4 Comprobar que cargó bien

1. Abre la app y pulsa **F12 → Console**. Si el catálogo tiene un id repetido,
   una URL mal escrita o un episodio sin fuente, verás un aviso
   `[catálogo] Revisa estos datos: ...` (no rompe la app, solo avisa).
2. Entra al anime → temporada → episodio. En el reproductor debe aparecer el
   badge **Externo** y el iframe con el player.
3. Si el iframe sale en negro pero abriendo la URL en otra pestaña funciona,
   es bloqueo de iframe del proveedor, no un fallo de Snowball.

> ⚠️ **Los vídeos actuales son de demostración** (archivos públicos de Google
> y un stream de prueba de Mux). Los derechos de los episodios y de las
> imágenes son responsabilidad de quien publica la web.

### 4.5 Catálogo remoto (actualizar sin recompilar el APK)

La app ya no depende de los datos empaquetados: al arrancar pide un JSON por
internet y, si cambió, repinta Inicio, Explorar, Mi lista y la ficha abierta.
Así puedes añadir o corregir animes y todos los usuarios lo ven al abrir la
app, sin publicar una versión nueva.

**Orden de carga:**

1. Copia guardada en `localStorage` (arranque instantáneo y sin conexión).
2. Si no hay copia, el catálogo incluido en `js/data/catalog.js`.
3. En segundo plano descarga `CFG.catalogUrl`; si el contenido es distinto,
   lo aplica, lo guarda y repinta.
4. Al volver a la app después de 5 minutos, vuelve a comprobar cambios.

**Formato del JSON** (`catalog.json`):

```json
{
  "version": 3,
  "updatedAt": "2026-10-29T12:00:00Z",
  "animes": [ /* mismas fichas de 4.1, con seasons y episodes */ ]
}
```

También acepta un array plano `[ {...}, {...} ]`. `version` y `updatedAt` son
informativos: la app compara el contenido completo, así que no hace falta
subir la versión a mano.

**Configuración** en `js/config.js`:

```js
catalogUrl: 'catalog.json',        // o 'https://.../catalog.json'
catalogTimeoutMs: 8000,            // si tarda más, usa la copia guardada
catalogCacheKey: 'snowball.catalog.v1',
catalogRefreshMs: 5 * 60 * 1000    // revisión al volver a la app
```

Déjalo en `''` para volver al modo 100 % local (solo `catalog.js`).

**Dónde alojarlo (gratis y con CORS):**

| Opción | URL de ejemplo | Notas |
|---|---|---|
| GitHub (raw) | `https://raw.githubusercontent.com/USUARIO/REPO/main/catalog.json` | Cambios al instante. `Access-Control-Allow-Origin: *`. |
| jsDelivr | `https://cdn.jsdelivr.net/gh/USUARIO/REPO@main/catalog.json` | CDN rápido, pero cachea ~12 h. |
| Supabase Storage | URL pública del bucket | Mismo proyecto que ya usas. Bucket público. |
| Tu hosting | `https://tudominio.com/catalog.json` | Lo más simple si la web ya está desplegada. |

> 📱 **En el APK usa siempre una URL absoluta `https://...`.** Si dejas
> `'catalog.json'`, el WebView lo busca dentro del paquete instalado y las
> actualizaciones no llegarían.

**Cómo publicar un cambio:**

1. Edita `catalog.json` (puedes generarlo desde `catalog.js` o escribirlo a mano).
2. Súbelo a GitHub / Supabase Storage / tu hosting.
3. Los usuarios lo reciben al abrir la app. Para forzarlo en tu equipo:
   `refreshCatalog()` en la consola (F12) o recarga con Ctrl + F5.

**Detalles importantes:**

- `catalog.json` es la **fuente de verdad**. `js/data/catalog.js` queda como
  respaldo empaquetado para el primer arranque sin red o si el JSON falla.
  Actualízalo solo cuando compiles una versión nueva del APK (opcional).
- Si el JSON viene roto, la app **no se queda vacía**: conserva la copia
  guardada y avisa en consola con `[catálogo remoto] ...`.
- La copia local usa `localStorage` (~5 MB). Para catálogos muy grandes
  (miles de episodios) conviene pasar a Supabase o IndexedDB.
- El servidor debe permitir CORS (`Access-Control-Allow-Origin: *`). GitHub,
  jsDelivr y Supabase Storage ya lo hacen.
- Los ids de temporadas/episodios deben seguir siendo únicos: si renombras un
  `id`, el progreso guardado de ese episodio deja de encontrarse.

Si más adelante quieres editar el catálogo desde un panel, se puede mover a
tablas de Supabase (`animes`, `seasons`, `episodes`) y construir el mismo
`window.CATALOG` al cargar; la interfaz no tendría que cambiar.

---

## 5. Qué hace la app

- **Router por hash**: `#/`, `#/explorar`, `#/mi-lista`, `#/titulo/:id`,
  `#/ver/:id/:temporada/:episodio`. Enlaces compartibles, botón atrás del
  navegador y recarga en la misma pantalla.
- **Continuar viendo**: guarda la posición cada 5 s (y al pausar/salir).
  Reanuda desde donde lo dejaste si pasaste de 10 s y no estabas en el final.
- **Siguiente episodio**: cuenta atrás de 4 s al terminar, también al cambiar
  de temporada.
- **Mini reproductor**: al minimizar sigue sonando y permite volver.
- **Favoritos** con badge en la pestaña y sincronización inmediata.
- **Comentarios** por anime: lectura pública, escritura y borrado solo del
  propio usuario (RLS). Enter para enviar, sin `alert()`.
- **Perfil**: nombre editable con validación y unicidad (sin distinguir
  mayúsculas), avatar de Google como fallback.
- **Accesibilidad**: iconos de la tab bar con `aria-label`/`title`,
  `focus-visible`, `prefers-reduced-motion`, textos `sr-only`.

Los tiempos se ajustan en `js/config.js`:

```js
progressMinSeconds: 5,      // ignora los primeros 5 s
progressSaveEveryMs: 5000,  // frecuencia de guardado
resumeFromSeconds: 10,      // mínimo para reanudar
autoNextDelayMs: 4000       // cuenta atrás del siguiente episodio
```

---

## 6. Desplegar

Es un sitio 100 % estático. Sube el proyecto a Netlify, Vercel, Cloudflare
Pages, GitHub Pages o cualquier hosting. Sin paso de build:

- **Build command**: *(vacío)*
- **Output directory**: `.` (la raíz del proyecto)

Después añade el dominio final a *Supabase → Authentication → URL
Configuration* (Site URL + Redirect URLs) y al OAuth client de Google si
cambias de dominio.

Checklist antes de publicar:

- [ ] `sql/schema.sql` ejecutado sin errores.
- [ ] `sql/migration-avatares.sql` ejecutado (fotos en comentarios).
- [ ] `catalog.json` subido y `catalogUrl` apuntando a su URL pública.
- [ ] Google provider activo y `.../auth/v1/callback` autorizado.
- [ ] Site URL y Redirect URLs con el dominio real.
- [ ] `js/config.js` con la URL y clave del proyecto de producción.
- [ ] `manifest.webmanifest`, `sw.js` e `icons/` subidos al hosting.
- [ ] La app abre por HTTPS y Chrome ofrece **Instalar app**.
- [ ] Vídeos y portadas con derechos de uso.
- [ ] Prueba de login, favorito, progreso y comentario en el dominio real.
- [ ] Aviso legal / política de privacidad publicados (obligatorio con Google
      OAuth y datos de usuarios).

---

## 7. Instalar en el móvil

La app se instala **desde el navegador** (PWA): no hace falta APK, ni tienda,
ni cable. Requisito único: que esté publicada por **HTTPS** (GitHub Pages,
Netlify, Vercel, Cloudflare Pages…). En `localhost` también se puede probar.

### 7.1 Android (Chrome)

1. Abre la URL de la app en **Chrome**.
2. Toca el menú **⋮** (arriba a la derecha).
3. Pulsa **Instalar app** o **Añadir a pantalla de inicio**.
4. Confirma. Aparece el icono de Snowball y se abre a pantalla completa, sin
   barra del navegador.

Si no sale la opción: recarga, espera unos segundos y vuelve a abrir el menú.
Chrome solo la ofrece cuando el manifest y el service worker cargan bien y la
página viene de HTTPS.

### 7.2 iPhone (Safari)

1. Abre la URL en **Safari** (no Chrome).
2. Botón **Compartir** → **Añadir a pantalla de inicio**.

### 7.3 Qué funciona offline

`sw.js` guarda `index.html`, el CSS, los JS y los iconos. Sin conexión la app
abre y muestra el catálogo guardado en el móvil (localStorage o el incluido en
`js/data/catalog.js`). Lo que **no** funciona sin internet: login, comentarios,
favoritos, progreso y el vídeo. El catálogo remoto se actualiza solo en cuanto
vuelve la conexión.

### 7.4 APK real (opcional)

Una PWA instalada ya se comporta como una app. Si aun así necesitas un archivo
`.apk` para repartir:

| Camino | Qué necesitas | Aviso |
|---|---|---|
| **PWABuilder** (recomendado) | Solo la URL publicada; la web genera el APK | Genera un *Trusted Web Activity*: es el navegador sin barra, así que el login de Google funciona |
| **Capacitor / Android Studio** | Node, JDK y Android Studio en tu PC | Más control, pero hay que compilar y firmar; el login de Google dentro de un WebView suele estar bloqueado |

Con TWA (PWABuilder) el `catalogUrl` **debe ser una URL absoluta**, porque el
APK no sirve los archivos locales igual que la web:

```js
catalogUrl: 'https://raw.githubusercontent.com/boladenieevee/boladenive/main/catalog.json',
```

Y el dominio del APK debe estar en *Supabase → Authentication → URL
Configuration* para que Google devuelva al usuario a la app.

> Un APK no se actualiza solo: cada cambio de HTML/CSS/JS obliga a subir una
> versión nueva a la tienda o al enlace de descarga. La PWA sí se actualiza al
> abrirla. Por eso el catálogo es remoto: los animes cambian sin recompilar.

---

## 8. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| "Google necesita http:// o https://" | Estás abriendo con `file://`. Usa `serve.ps1` o el hosting. |
| `redirect_uri_mismatch` | La URL no está en Google Cloud ni en Supabase Redirect URLs. |
| "Falta la tabla favorites/progress" | No se ejecutó `sql/schema.sql`. |
| Los comentarios no cargan | Ejecuta el SQL actualizado (columna `anime_id`) y revisa RLS. |
| El vídeo no arranca solo | El navegador bloquea el autoplay con sonido; pulsa ▶. |
| HLS no reproduce | Sin conexión al CDN de hls.js o formato no soportado. |
| El nombre de usuario ya existe | Los nombres son únicos sin distinguir mayúsculas. |
| Los cambios del catálogo no aparecen | Revisa `catalogUrl` (URL absoluta en el APK), CORS del hosting y prueba `refreshCatalog()` en consola. |
| El catálogo no carga y la app usa datos viejos | El JSON remoto falló o es inválido: mira `[catálogo remoto]` en la consola. |
| Chrome no muestra "Instalar app" | Falta HTTPS, o no cargan `manifest.webmanifest`, `sw.js` o los iconos (revisa que estén subidos y den 200). |
| Al instalar la PWA sale un icono genérico | Los PNG de `icons/` no se subieron o la ruta del manifest es incorrecta. |
| La PWA sigue mostrando la versión vieja | Cierra la app del todo y vuelve a abrirla; el service worker pide red primero, pero puede tardar un ciclo. |
| Login de Google falla solo en el móvil | El dominio publicado no está en Supabase *Site URL / Redirect URLs*. |

---

## 9. Nota legal

Snowball es el reproductor: **no incluye ni aloja contenido con derechos de
terceros**. Los títulos, sinopsis y episodios del catálogo son datos de
demostración. Para un lanzamiento real necesitas licencias de distribución de
cada obra y de cada vídeo, además de política de privacidad, términos de uso y
gestión de datos conforme al RGPD. Las marcas y logotipos de terceros
pertenecen a sus titulares.
