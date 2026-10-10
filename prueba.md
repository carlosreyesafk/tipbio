# Pruebas — TipBio (negocio #27)

**Fecha:** 2026-10-09 ~20:55 AST
**Método:** `node --check`, servidor local `python3 -m http.server` + curl, y suite de pruebas de funciones puras en Node (eval del app.js real + asserts).

## 1. Sintaxis JS
- `node --check app.js` → **OK, sin errores.**

## 2. Servidor local + HTTP
- `python3 -m http.server 8899` en el directorio del negocio.
- `curl -s -o /dev/null -w "%{http_code}"`:
  - `index.html` → **200**
  - `styles.css` → **200**
  - `app.js` → **200**
- Verificación de contenido: la dirección USDT `0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172` aparece exacta (3× en index.html, 1× en app.js); `chachiafk@gmail.com` aparece (4× index.html, 6× app.js); el badge "Hecho con TipBio by Chachi" está presente. Cero errores de tipeo en los valores de cobro.

## 3. Funciones puras (10/10 asserts pasaron)
Suite en `/tmp/tipbio-test.mjs` ejecutada con `node` (exit 0):
1. **encode/decode roundtrip** con unicode (emoji ▶️✨, ñ, tildes): el hash es base64url limpio (sin `+/=`) y `decodeBio(encodeBio(obj))` deep-equal al original → OK.
2. **decodeBio con entrada inválida** (`!!!no-es-base64!!!`, JSON sin campo `name`, string vacío) → `null` sin lanzar excepción → OK.
3. **Código PRO SHA-256**: formato 16 hex; determinista; normaliza email (mayúsculas/espacios → mismo código); email distinto → código distinto; `verifyProCode` acepta el código propio (incluso con mayúsculas/espacios) y rechaza uno falso. Código de `chachiafk@gmail.com` = `8a8aa3f9a86f9d73` → OK.
4. **Receipt válido**: Transfer del contrato USDT-BSC oficial a 0xb2a3…f172 por exactamente 19 USDT (BigInt, 18 decimales), status 0x1 → `ok:true` → OK.
5. **status 0x0** → rechaza → OK.
6. **18.9 USDT** (< 19) → rechaza → OK.
7. **Transfer a otra dirección** → rechaza → OK.
8. **Contrato que no es USDT-BSC** → rechaza → OK.
9. **Suma de múltiples Transfers** (12 + 7 USDT al mismo destino) → acumula y aprueba → OK.
10. **Receipt sin logs** → rechaza → OK.

## 4. Lógica verificada por lectura (sin navegador disponible)
- `enterViewMode`: regex `^#b=(.+)$` sobre `location.hash`; si el decode falla, la landing se muestra normal (no rompe).
- QR: `img.onerror` oculta la imagen y muestra el bloque de reintento con botón "Reintentar" — no crashea sin red.
- Paywall USDT: itera los 5 RPCs públicos en orden y tolera fallos (try/catch por RPC); valida formato del hash antes de llamar.
- Código PayPal: usa `crypto.subtle` con mensaje de error elegante si el contexto no es seguro.
- El tip jar del constructor usa exclusivamente los valores que escribe el creador (nunca los de Chachi); los rieles de Chachi solo aparecen en landing/modal PRO con disclaimer explícito.
- Toggle ES/EN: diccionario completo en ambos idiomas, `data-i18n` / `data-i18n-ph`, persistencia en `localStorage.tipbio_lang`.

## Limitaciones conocidas (honestas)
- **No se probó renderizado visual en navegador real** (este subagente no opera navegador): el diseño se verificó por código (CSS responsive mobile-first con breakpoints 640px/960px), no con captura de pantalla.
- **La verificación on-chain real** (`fetchReceipt` contra RPCs de BSC) no se ejecutó contra la red — solo la lógica de parseo con receipts simulados (pruebas 4–10). El primer pago real servirá como prueba de fuego.
- **El QR** depende de `api.qrserver.com` (gratis, sin key); si ese servicio cae, el fallback de reintento cubre la UX pero no genera QR offline.
- **`crypto.subtle`** requiere contexto seguro (HTTPS o localhost): en GitHub Pages (HTTPS) funciona; en `file://` no.
- El desbloqueo PRO vive en `localStorage` del navegador del comprador (diseño intencional, documentado en ficha.md).

## Resultado
**APTO para deploy** (el deploy a GitHub Pages lo hace el parent). Sin placeholders, sin estadísticas inventadas, sin testimonios falsos. Firma "© 2026 Chachi" en footer.
