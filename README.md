# SAM Speed Dial — primera rebanada

PoC del Speed Dial de SAM según `SAM-SD-001`. Implementa la rebanada mínima acordada y, encima, el alta en modal con imagen y grupos.

- Sitio publicado: <https://sam-speed-dial-6wishq.freebuff.site>
- Repositorio: <https://github.com/rodolfozamarripatirado/sam-speed-dial>

> El sitio no tiene inicio de sesión: cualquiera con el enlace puede ver, agregar y borrar accesos. No lo uses con datos personales hasta añadir autenticación.

## Qué incluye

- **Tarjeta `+`** en la rejilla que abre un modal para dar de alta un acceso. El formulario ya no está siempre visible.
- **Imagen opcional por tarjeta.** Se guarda en un bucket R2 y se sirve desde `/api/images/:key`. En la tarjeta ocupa el marco completo con `object-fit: cover`: se recorta al tamaño de la tarjeta sin deformarse.
- **Grupos.** Cada acceso puede pertenecer a un grupo; la rejilla se muestra por secciones con el nombre del grupo. Un grupo nuevo se crea escribiendo su nombre y los existentes se reutilizan sin duplicarse (comparación sin distinguir mayúsculas).
- **Sin imagen**, la tarjeta usa un monograma con color derivado del dominio.
- Validación de esquema `http://` / `https://`, longitud de campos, URLs sin credenciales y títulos sin caracteres de control.
- Las imágenes se validan por **contenido** (firma del archivo), no por extensión ni por el tipo declarado: PNG, JPG, WEBP o GIF hasta 2 MB. SVG y cualquier otro formato se rechazan.
- Si la imagen pesa más de 400 KB o supera 1200 px de lado, el navegador la reduce antes de subirla.
- SQL parametrizado en todas las consultas. Los títulos se pintan con `textContent`, nunca con `innerHTML`.
- Base de datos y bucket son bindings del Worker: no hay cadena de conexión ni secreto alguno en el navegador.
- Posición calculada dentro del propio `INSERT`, para que dos altas simultáneas no se sobrescriban.
- Caída de base de datos → `503` con mensaje genérico, sin detalles internos.
- Al borrar una tarjeta se borra también su imagen del bucket.
- Base de datos y despliegue dedicados, separados de SAM OMS/RAG.

## Estructura

```
worker.js          API + esquema/migración (D1) y almacenamiento de imágenes (R2)
public/            index.html, styles.css, app.js (sin build step)
manifest.json      manifiesto de despliegue del Worker con assets estáticos
test/local.mjs     arnés que ejecuta el Worker contra SQLite en memoria + R2 simulado
```

## Correr las pruebas

```bash
npm test
```

18 comprobaciones con un shim mínimo de D1 y R2 sobre `node:sqlite`. Cubre: siembra inicial, alta válida, rechazo de `javascript:` / `data:` / `file:`, títulos vacíos, credenciales en la URL, cuerpo no-JSON, alta multipart con grupo e imagen, reutilización de grupos sin duplicar, rechazo de SVG y de archivos que mienten sobre su tipo, límite de 2 MB, imagen inexistente, borrado de la imagen junto con la tarjeta, altas concurrentes con posiciones únicas, borrado persistente, reinicio sin duplicar datos, **migración de una base con el esquema anterior** y `503` genérico ante caída de la base.

## API

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `GET` | `/api/entries` | `200 { entries: [...], groups: [...] }` |
| `POST` | `/api/entries` | `201 { entry, groups }`; `400` datos inválidos, `413` imagen demasiado grande, `415` formato no permitido |
| `DELETE` | `/api/entries/:id` | `204`, `404` si ya no existe |
| `GET` | `/api/images/:key` | imagen con `cache-control` largo y `content-type` verificado |

El alta acepta JSON (`{ title, url, groupName }`) o `multipart/form-data` con `title`, `url`, `groupName` e `image`.

Cada entrada: `{ id, title, url, position, createdAt, groupId, imageUrl }`.

## Estado frente a los criterios de aceptación de SAM-SD-001

| Criterio | Estado |
| --- | --- |
| Entradas semilla renderizan y abren | Parcial: con datos de ejemplo. El export real (`bookmarks_20_11_2026.html`) no se ha importado. |
| Alta en un dispositivo aparece en otro tras recargar | Cumplido: persistencia en base de datos del servidor. |
| Borrado persiste tras recargar y reiniciar | Cumplido. |
| Altas concurrentes no se sobrescriben | Cumplido y cubierto en `npm test`. |
| Esquemas de URL inseguros rechazados | Cumplido y cubierto en `npm test`. |
| Sin secreto de base de datos en el navegador ni en logs | Cumplido: bindings del Worker, sin cadena de conexión. |
| Caída de base → respuesta genérica de no disponible | Cumplido (`503`). |
| Aislamiento respecto a SAM OMS/RAG | Cumplido: base y bucket propios. |
| Ningún servicio de pago | Cumplido (D1 y R2 dentro del plan gratuito del hosting). |
| Acceso solo por Tailscale, acceso público bloqueado | **No cumplido.** El despliegue es público (Cloudflare). |
| PostgreSQL externo gratuito con rol dedicado | **No cumplido.** Se usa Cloudflare D1 (SQLite) porque el destino de publicación no ejecuta un servidor Node/Python. |
| Revisión independiente de la evidencia | **Pendiente.** Esta implementación no se aprueba a sí misma. |

Las dos filas de infraestructura son desviaciones conscientes respecto a la spec, no olvidos. Si Tailscale y Postgres son obligatorios para la aceptación, hay que mover la misma API a ese entorno antes de aprobar.

## Fuera de alcance (diferido según la spec)

Catálogo de propósito por sitio, tooltip de tres segundos, mover/redimensionar tarjetas, animación de píxeles, edición de accesos existentes, reordenar grupos, borrar grupos y la importación automática del export de Opera. La agrupación y la imagen por tarjeta se añadieron después de la revisión de la rebanada de una hora, así que quedan fuera de ese alcance acordado y de su aceptación.
