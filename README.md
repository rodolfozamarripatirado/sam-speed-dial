# SAM Speed Dial — primera rebanada

PoC del Speed Dial de SAM según `SAM-SD-001`. Implementa la rebanada mínima acordada: **listar, agregar y eliminar accesos**, con persistencia en el servidor.

- Sitio publicado: <https://sam-speed-dial-6wishq.freebuff.site>
- Repositorio: <https://github.com/rodolfozamarripatirado/sam-speed-dial>

## Qué incluye

- Tiles responsivos con enlace, título y dominio. El ícono es un monograma generado en el cliente: no se piden favicons ni se llama a servicios externos.
- Alta desde un formulario y borrado desde cada tile.
- API JSON con validación de esquema `http://` / `https://`, longitud de campos y URLs sin credenciales.
- SQL parametrizado en todas las consultas. Los títulos se pintan con `textContent`, nunca con `innerHTML`.
- La base de datos es un binding del Worker: no hay cadena de conexión ni secreto alguno en el navegador.
- Posición calculada dentro del propio `INSERT`, para que dos altas simultáneas no se sobrescriban.
- Caída de base de datos → `503` con mensaje genérico, sin detalles internos.
- Base de datos, tabla y despliegue dedicados, separados de SAM OMS/RAG.

## Estructura

```
worker.js          API (GET/POST /api/entries, DELETE /api/entries/:id) + esquema
public/            index.html, styles.css, app.js (sin build step)
manifest.json      manifiesto de despliegue del Worker con assets estáticos
test/local.mjs     arnés que ejecuta el Worker contra SQLite en memoria
```

## Correr las pruebas

```bash
npm test
```

El arnés implementa un shim mínimo de D1 sobre `node:sqlite` y cubre: siembra inicial, alta válida, entradas nuevas en el listado, rechazo de `javascript:` / `data:` / `file:`, títulos vacíos, credenciales en la URL, cuerpo no-JSON, cinco altas concurrentes con posiciones únicas, borrado persistente con `404` al repetirlo, reinicio del Worker sin duplicar datos y `503` genérico ante caída de la base.

## API

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `GET` | `/api/entries` | `200 { entries: [...] }` |
| `POST` | `/api/entries` | `201 { entry }`, `400` si los datos no son válidos |
| `DELETE` | `/api/entries/:id` | `204`, `404` si ya no existe |

Cada entrada: `{ id, title, url, position, createdAt }`.

## Estado frente a los criterios de aceptación de SAM-SD-001

| Criterio | Estado |
| --- | --- |
| Entradas semilla renderizan y abren | Parcial: con datos de ejemplo. El export real (`bookmarks_20_11_2026.html`) no se ha importado. |
| Alta en un dispositivo aparece en otro tras recargar | Cumplido: persistencia en base de datos del servidor. |
| Borrado persiste tras recargar y reiniciar | Cumplido. |
| Altas concurrentes no se sobrescriben | Cumplido y cubierto en `npm test`. |
| Esquemas de URL inseguros rechazados | Cumplido y cubierto en `npm test`. |
| Sin secreto de base de datos en el navegador ni en logs | Cumplido: binding del Worker, sin cadena de conexión. |
| Caída de base → respuesta genérica de no disponible | Cumplido (`503`). |
| Aislamiento respecto a SAM OMS/RAG | Cumplido: base y tabla propias. |
| Ningún servicio de pago | Cumplido. |
| Acceso solo por Tailscale, acceso público bloqueado | **No cumplido.** El despliegue es público (Cloudflare). |
| PostgreSQL externo gratuito con rol dedicado | **No cumplido.** Se usa Cloudflare D1 (SQLite) porque el destino de publicación no ejecuta un servidor Node/Python. |

Las dos últimas filas son desviaciones conscientes respecto a la spec, no olvidos: la spec exige PostgreSQL externo y exposición solo por Tailscale, y este despliegue usa D1 sobre un dominio público. Si esas condiciones son obligatorias para la aceptación, hay que mover la misma API a Postgres + Tailscale antes de aprobar.

## Fuera de alcance (diferido según la spec)

Catálogo de propósito por sitio, tooltip de tres segundos, grupos, mover/redimensionar, animación de píxeles, importación automática del export de Opera y cualquier llamada a sitios externos.
