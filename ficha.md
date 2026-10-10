# Ficha del negocio #27 — TipBio

**Fecha de construcción:** 2026-10-09
**Directorio:** `negocios-100-oleada4/tipbio/`
**URL pública prevista:** https://carlosreyesafk.github.io/tipbio/ (deploy pendiente del parent)
**Estado:** construido y verificado localmente (curl 200, pruebas 10/10). NO desplegado — no cuenta como "corriendo" hasta el deploy.

## Negocio
**TipBio** = link-in-bio + tip jar para creadores de contenido. Sitio estático de una sola página (index.html + styles.css + app.js, 100% cliente, sin backend, sin API keys) que combina:
1. **Landing** con hero, features, pricing, FAQ y rieles de cobro visibles.
2. **Constructor de bio**: perfil (nombre, @handle, foto por URL, bio corta), lista de enlaces (emoji opcional + texto + URL), tip jar con **el PayPal.me y la dirección USDT del propio creador**, y vista previa en vivo dentro de un marco de teléfono.
3. **Página pública por URL hash**: el constructor genera `https://carlosreyesafk.github.io/tipbio/#b=<base64>` con la bio codificada; si la página carga con ese hash, renderiza la bio en modo vista (página de enlaces real para compartir), con botón "Copiar link" y QR vía `api.qrserver.com` (con mensaje elegante de reintento si falla la red).

## Precio
- **Gratis:** 2 temas, links ilimitados, tip jar, link + QR, badge visible "Hecho con TipBio by Chachi".
- **PRO — US$19 pago único:** 6 temas premium + se quita el badge. El desbloqueo queda en `localStorage.tipbio_pro=1` y se incrusta `pro:true` en el link generado (la página pública del comprador PRO sale sin badge).

## Comprador
Creadores de contenido, streamers, artistas y músicos que hoy usan **Linktree gratis** (o Carrd/Beacons) y quieren recibir propinas sin pagar comisiones ni mensualidades. El gancho diferencial: tip jar con PayPal + USDT cripto, **0% comisión** (el dinero va directo al creador, TipBio no lo toca), y PRO de pago único en vez de suscripción.

## Entregable
- `index.html` — landing + constructor + modo vista + modal PRO, toggle ES/EN.
- `styles.css` — diseño premium mobile-first, 8 temas (2 gratis + 6 PRO).
- `app.js` — núcleo puro testeable (base64url, SHA-256, verificación on-chain) + lógica de navegador.
- `ficha.md` (este archivo), `prueba.md` (resultados del QA).

## Vía de cobro (compra de PRO — rieles de CHACHI)
- **PayPal:** chachiafk@gmail.com
- **USDT red BSC (BEP-20):** 0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172

### Esquema de verificación PRO (documentación técnica)
**Vía USDT (automática):** el comprador pega el hash de su transacción BSC. El JS llama `eth_getTransactionReceipt` a RPCs públicos de BSC (bsc-dataseed.binance.org, bsc-dataseed1/2/3, bsc.publicnode.com — prueba en orden hasta que uno responda) y verifica:
1. `receipt.status == 0x1` (transacción exitosa),
2. existe un evento `Transfer` (topic `0xddf252ad…`) emitido por el contrato oficial USDT-BSC `0x55d398326f99059ff775485246999027b3197955`,
3. el destinatario (`topics[2]`) es `0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172`,
4. la suma de los valores (`data`, aritmética **BigInt**, 18 decimales) es ≥ 19 USDT.
Éxito → `localStorage.tipbio_pro=1` y desbloqueo inmediato.

**Vía PayPal (manual):** el comprador envía US$19 a chachiafk@gmail.com y reenvía su recibo al mismo correo. Chachi le entrega un **código** = primeros 16 caracteres hex de `SHA-256("CHACHI-PRO-" + email en minúsculas y sin espacios)`. El JS recalcula con `crypto.subtle` y compara. Sin servidor.

### ⚠️ Distinción crítica (también visible en la UI)
- Los rieles de la **landing / modal PRO** (PayPal chachiafk@gmail.com + USDT 0xb2a3…f172) son de **Chachi** y sirven ÚNICAMENTE para comprar TipBio PRO.
- El **tip jar del constructor** es 100% del **creador**: él pone SU PayPal.me y SU dirección USDT; las propinas van directo a él, TipBio no cobra comisión ni las toca. La UI lo repite en el constructor, la landing (sección rieles) y el modal PRO.

## Distribución
- Outreach directo a micro-creadores (streamers pequeños de Twitch, tiktokers RD/LatAm, músicos independientes): mensaje corto ofreciendo la bio gratis + tip jar sin comisión.
- Comunidades: servidores de Discord de creadores, grupos de Facebook de streamers RD, replies útiles en X/Twitter a creadores quejándose de comisiones de Linktree/ko-fi.
- El propio link de ejemplo + QR sirven como demo viva.

## Criterio de muerte
**0 ventas PRO con ≥300 visitas en 60 días → se mata (fecha: 2026-12-09).**
Medición: visitas a la URL pública (GitHub Pages no da analytics; usar un contador simple o el tráfico referido del outreach como proxy honesto) + pagos verificados (el paywall deja rastro: cada desbloqueo USDT es una transacción visible en BSCScan hacia 0xb2a3…f172; cada código PayPal emitido queda en el correo).

## Diferenciación vs. negocios existentes
Verificado contra `contador-negocios.md` (2026-10-09): no duplica ninguno. Los generadores existentes (ContractKit #9, CVForge #20, MetricForge #21, PropOne #22) son herramientas de documentos/cálculos/propuestas; ninguno es link-in-bio + tip jar para creadores, y ninguno monetiza con PRO one-time ligado a propinas de terceros. Modelo y vía de dinero distintos → negocio nuevo legítimo (#27 construido, pendiente de deploy para contar como corriendo).
