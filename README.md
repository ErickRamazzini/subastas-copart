# SubastasGT – Plataforma de Subastas de Vehículos en Tiempo Real (Caso Copart)

## 🌐 Sitio publicado
https://erickramazzini.github.io/subastas-copart/

## 👤 Usuarios de prueba
| # | Correo | Contraseña |
|---|--------|------------|
| 1 | vendedor@subastas.com | Vendedor#2026 |
| 2 | comprador1@subastas.com | Comprador1#2026 |
| 3 | comprador2@subastas.com | Comprador2#2026 |

## 🧱 Arquitectura
- **Frontend:** SPA en JavaScript (módulos ES, enrutador por hash), Bootstrap 5, publicada en GitHub Pages.
- **Backend:** Firebase – Authentication (registro/login) y Cloud Firestore (base de datos en tiempo real).
- **Tiempo real:** `onSnapshot` de Firestore actualiza oferta, indicadores y temporizador sin recargar (sin F5).
- **Validación en servidor:** reglas de seguridad de Firestore (`firestore.rules`):
  - Solo usuarios autenticados publican y ofertan (anónimos solo ven el catálogo).
  - Oferta ≥ monto base, mayor a la actual y con incremento mínimo del 10 %.
  - Solo se puede ofertar entre la fecha/hora de inicio y cierre.
  - El publicador no puede ofertar en su propio vehículo.
  - Postores anónimos: nadie ve la identidad de quién ofertó, solo el monto.

## ✅ Funcionalidades
- Registro (nombre, apellido, correo, teléfono, contraseña segura) e inicio de sesión.
- Publicación con ficha técnica completa, clasificación de daño (verde/amarillo/rojo), mínimo 5 fotos y parámetros de subasta.
- “Mis publicaciones” con búsqueda y edición.
- Inventario con filtros multitarea (año, marca, modelo, daño, combustible, transmisión, tren, tipo, estado).
- Detalle con carrusel de imágenes, ficha técnica, puja en tiempo real, temporizador e indicadores
  “¡Vas ganando esta subasta!” / “Tu oferta ha sido superada”.
- Cierre automático: oferta cerrada; si no hubo ofertas ≥ monto base, la subasta se declara no vendida/desierta.
