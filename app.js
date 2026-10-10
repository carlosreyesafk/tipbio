'use strict';
/* =====================================================================
   TipBio — link-in-bio + tip jar para creadores (100% cliente)
   Núcleo puro (sin DOM) arriba: testeable en Node.
   Lógica de navegador abajo, protegida por guard de entorno.
   ===================================================================== */

/* ---------- constantes ---------- */
const USDT_BSC_CONTRACT = '0x55d398326f99059ff775485246999027b3197955'; // USDT oficial en BSC
const CHACHI_USDT_BSC    = '0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172'; // cobro PRO (Chachi)
const CHACHI_PAYPAL      = 'chachiafk@gmail.com';                        // cobro PRO (Chachi)
const TRANSFER_TOPIC     = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4dfdfc67'; // keccak256("Transfer(address,address,uint256)")
const PRO_WEI            = 19n * (10n ** 18n); // 19 USDT, 18 decimales, aritmética BigInt
const PRO_PRICE_LABEL    = 'US$19';
const PUBLIC_BASE        = 'https://carlosreyesafk.github.io/tipbio/';
const BSC_RPCS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc.publicnode.com'
];

const THEMES = [
  { id:'t-neon',      es:'Neón',      en:'Neon',      premium:false, dot:'linear-gradient(135deg,#7c6cff,#22d3ee)' },
  { id:'t-clarito',   es:'Clarito',   en:'Light',     premium:false, dot:'linear-gradient(135deg,#f8fafc,#cbd5e1)' },
  { id:'t-medianoche',es:'Medianoche',en:'Midnight',  premium:true,  dot:'linear-gradient(135deg,#000,#a855f7)' },
  { id:'t-atardecer', es:'Atardecer', en:'Sunset',    premium:true,  dot:'linear-gradient(135deg,#ff9a56,#7c3aed)' },
  { id:'t-bosque',    es:'Bosque',    en:'Forest',    premium:true,  dot:'linear-gradient(135deg,#052e22,#34d399)' },
  { id:'t-dulce',     es:'Dulce',     en:'Candy',     premium:true,  dot:'linear-gradient(135deg,#ffc7e3,#be185d)' },
  { id:'t-dorado',    es:'Dorado',    en:'Gold',      premium:true,  dot:'linear-gradient(135deg,#3a2a12,#fbbf24)' },
  { id:'t-minimo',    es:'Mínimo',    en:'Minimal',   premium:true,  dot:'linear-gradient(135deg,#fff,#111)' }
];

/* ---------- base64url UTF-8 (Node + navegador) ---------- */
function utf8ToB64(str){
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64url');
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64ToUtf8(b64){
  const s = String(b64).replace(/-/g,'+').replace(/_/g,'/');
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function encodeBio(obj){ return utf8ToB64(JSON.stringify(obj)); }
function decodeBio(b64){
  try {
    const obj = JSON.parse(b64ToUtf8(b64));
    if (!obj || typeof obj !== 'object' || typeof obj.name !== 'string') return null;
    return obj;
  } catch (e){ return null; }
}

/* ---------- SHA-256 (WebCrypto; Node 24 lo trae global) ---------- */
async function sha256Hex(str){
  const subtle = (typeof crypto !== 'undefined' && crypto.subtle)
    ? crypto.subtle
    : (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle ? globalThis.crypto.subtle : null);
  if (!subtle) throw new Error('NO_SUBTLE');
  const data = (typeof Buffer !== 'undefined')
    ? Buffer.from(str, 'utf8')
    : new TextEncoder().encode(str);
  const digest = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ---------- código PRO vía PayPal ----------
   Esquema (documentado en ficha.md):
   - El comprador envía US$19 a chachiafk@gmail.com y reenvía su recibo.
   - Chachi le entrega un código = primeros 16 hex de
     SHA-256("CHACHI-PRO-" + email en minúsculas y sin espacios).
   - El JS recalcula y compara. Sin servidor. */
function normalizeEmail(email){ return String(email || '').toLowerCase().replace(/\s+/g, ''); }
async function proCodeFor(email){ return (await sha256Hex('CHACHI-PRO-' + normalizeEmail(email))).slice(0, 16); }
async function verifyProCode(email, code){
  const expected = await proCodeFor(email);
  const given = String(code || '').toLowerCase().replace(/\s+/g, '');
  return given.length === 16 && given === expected;
}

/* ---------- verificación on-chain del pago USDT (BSC) ---------- */
function verifyUsdtReceipt(receipt){
  if (!receipt || receipt.status !== '0x1') return { ok:false, reason:'status' };
  const ours = CHACHI_USDT_BSC.toLowerCase();
  const usdt = USDT_BSC_CONTRACT.toLowerCase();
  let total = 0n;
  for (const log of (receipt.logs || [])){
    if (String(log.address || '').toLowerCase() !== usdt) continue;
    const topics = log.topics || [];
    if (topics[0] !== TRANSFER_TOPIC) continue;
    const to = ('0x' + String(topics[2] || '').slice(-40)).toLowerCase();
    if (to !== ours) continue;
    try { total += BigInt(log.data || '0x0'); } catch (e){ /* dato malformado: se ignora */ }
  }
  return { ok: total >= PRO_WEI, total, required: PRO_WEI };
}
async function fetchReceipt(txHash){
  const body = JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionReceipt', params:[txHash] });
  for (const rpc of BSC_RPCS){
    try {
      const res = await fetch(rpc, { method:'POST', headers:{ 'Content-Type':'application/json' }, body });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.result) return json.result;
    } catch (e){ /* siguiente RPC */ }
  }
  return null;
}
async function verifyTxOnChain(txHash){
  const h = String(txHash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return { ok:false, reason:'hash' };
  const receipt = await fetchReceipt(h);
  if (!receipt) return { ok:false, reason:'notfound' };
  return verifyUsdtReceipt(receipt);
}

/* =====================================================================
   NAVEGADOR (no se ejecuta en Node)
   ===================================================================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function(){
  'use strict';

  /* ---------- i18n ---------- */
  const I18N = {
    es: {
      nav_features:'Funciones', nav_pricing:'Precios', nav_faq:'Preguntas', nav_cta:'Crear mi bio',
      hero_eyebrow:'Para creadores, streamers y artistas',
      hero_title:'Tu link en bio que también recibe propinas',
      hero_sub:'Crea tu página de enlaces en 1 minuto: tus links, tu bio y tu tip jar con PayPal y USDT. Gratis para siempre — y TipBio no toca un centavo de tus propinas.',
      hero_cta1:'Crear mi bio gratis', hero_cta2:'Ver ejemplo',
      hero_note:'Sin cuenta · Sin comisiones · Tu link queda codificado en la URL',
      features_title:'Todo lo que necesitas en un solo link',
      f1_title:'Links ilimitados', f1_text:'Agrega todos tus enlaces con emoji opcional: YouTube, Twitch, tienda, Spotify, lo que sea. Se actualizan al instante.',
      f2_title:'Tip jar 100% tuyo', f2_text:'Conecta TU PayPal.me y TU dirección USDT (red BSC). Las propinas van directo a ti — TipBio no cobra comisión ni las toca.',
      f3_title:'Temas que se ven premium', f3_text:'2 temas gratis y 6 temas PRO. Vista previa en vivo en un marco de teléfono mientras editas.',
      f4_title:'Comparte con link o QR', f4_text:'Tu bio vive en un link corto con QR incluido. Pégalo en tu bio de Instagram, TikTok, Twitch o donde quieras.',
      rails_title:'Rieles de cobro',
      rails_disclaimer:'⚠️ Estos rieles son de Chachi y sirven únicamente para comprar TipBio PRO. Las propinas de tu tip jar van 100% a TUS propias cuentas, que configuras en el constructor.',
      copy:'Copiar', copied:'¡Copiado!',
      pricing_title:'Un precio simple, para siempre',
      free_title:'Gratis', pro_title:'PRO', pro_per:'pago único', pro_badge:'Recomendado',
      free_l1:'✅ Links ilimitados', free_l2:'✅ Tip jar con tu PayPal y tu USDT', free_l3:'✅ 2 temas', free_l4:'✅ Link compartible + QR', free_l5:'🏷️ Badge "Hecho con TipBio by Chachi"',
      free_cta:'Empezar gratis',
      pro_l1:'✅ Todo lo del plan gratis', pro_l2:'✅ 6 temas premium', pro_l3:'✅ Sin badge — tu marca, limpia', pro_l4:'✅ Soporte prioritario',
      pro_cta:'Desbloquear PRO',
      faq_title:'Preguntas frecuentes',
      q1:'¿TipBio cobra comisión de mis propinas?', a1:'No. Cero comisión. El tip jar usa tu propio link de PayPal.me y tu propia dirección USDT — el dinero va directo a ti y TipBio nunca lo toca ni lo ve.',
      q2:'¿Necesito crear una cuenta?', a2:'No. Todo funciona en tu navegador: armas tu bio, generas tu link y lo compartes. Tu bio queda codificada dentro del propio link.',
      q3:'¿Cómo consigo PRO?', a3:'US$19 pago único. Puedes pagar con USDT (red BSC) y verificar tu transacción automáticamente, o con PayPal escribiendo a chachiafk@gmail.com para recibir tu código de activación manual.',
      q4:'¿Dónde se guardan mis datos?', a4:'En el link mismo: tu bio se codifica en la URL. No hay base de datos, no hay rastreo, no hay cuenta que hackear.',
      q5:'¿Puedo cambiar mi bio después?', a5:'Sí. Vuelve al constructor, edita lo que quieras y genera un link nuevo. Los links viejos siguen funcionando con la versión que tenían.',
      builder_title:'Constructor de bio',
      builder_sub:'Completa tu perfil y mira el resultado en vivo. El tip jar es 100% tuyo: pon TU PayPal.me y TU dirección USDT.',
      sec_profile:'👤 Perfil', sec_links:'🔗 Enlaces', sec_tip:'💸 Tip jar (100% tuyo)', sec_theme:'🎨 Tema',
      lbl_name:'Nombre', lbl_handle:'@handle', lbl_photo:'Foto (URL)', lbl_bio:'Bio corta',
      ph_name:'Tu nombre o apodo', ph_handle:'@tucuenta', ph_photo:'https://…/tu-foto.jpg', ph_bio:'Streamer · Música · Lo que haces en una línea',
      add_link:'+ Agregar enlace', link_emoji:'😀', link_text:'Texto del enlace', link_url:'https://…',
      tip_note:'⚠️ Pon TUS propias cuentas. Las propinas llegan directo a ti — TipBio no cobra comisión.',
      lbl_paypal:'Tu PayPal.me', lbl_usdt:'Tu USDT (red BSC / BEP-20)',
      ph_paypal:'https://paypal.me/tuusuario', ph_usdt:'0xTuDirección…',
      unlock_pro:'Desbloquear PRO — US$19',
      pro_active:'✅ PRO activo — 8 temas desbloqueados, sin badge.',
      pro_locked:'🔒 6 temas premium bloqueados.',
      premium_only:'Tema PRO — desbloquéalo para usarlo',
      generate:'Generar mi link', share_title:'🎉 Tu bio está lista',
      copy_link:'Copiar link', show_qr:'Ver QR',
      qr_fail:'No se pudo cargar el QR (revisa tu conexión).', retry:'Reintentar',
      preview:'Vista previa en vivo',
      pro_modal_title:'Desbloquear TipBio PRO — US$19 pago único',
      pro_rails_note:'⚠️ Estos rieles son de Chachi (compra de PRO). Tu tip jar del constructor sigue siendo 100% tuyo.',
      pay_usdt_title:'Opción 1 · USDT (red BSC) — verificación automática',
      pay_usdt_1:'Envía ≥ 19 USDT (BEP-20) a:',
      pay_usdt_2:'Pega el hash de la transacción:',
      ph_tx:'0x…', verify_pay:'Verificar pago',
      pay_pp_title:'Opción 2 · PayPal — código manual',
      pay_pp_1:'Envía US$19 por PayPal a chachiafk@gmail.com y reenvía tu recibo al mismo correo.',
      pay_pp_2:'Recibirás un código de activación. Ingrésalo junto a tu email:',
      ph_email:'tu@email.com', ph_code:'Código de 16 caracteres', activate:'Activar PRO',
      tip_title:'💸 Apóyame con una propina',
      no_tip:'El creador aún no configuró su tip jar.',
      badge:'Hecho con <a href="'+PUBLIC_BASE+'">TipBio</a> by Chachi',
      footer_made:'Hecho con ⚡ para creadores',
      msg_verifying:'Verificando en la blockchain…', msg_notfound:'No se encontró la transacción o ningún RPC respondió. Revisa el hash e inténtalo de nuevo.',
      msg_badhash:'Ese hash no parece válido (formato 0x + 64 hex).',
      msg_low:'Esa transacción no transfirió ≥ 19 USDT a la dirección de cobro.',
      msg_ok:'✅ ¡Pago verificado! PRO desbloqueado.',
      msg_code_ok:'✅ ¡Código válido! PRO desbloqueado.',
      msg_code_bad:'Código o email incorrecto. Revisa y vuelve a intentar.',
      msg_nosubtle:'Tu navegador no permite verificar el código aquí (se necesita contexto seguro).',
      default_name:'Tu Nombre', default_bio:'Mi bio en una línea ✨'
    },
    en: {
      nav_features:'Features', nav_pricing:'Pricing', nav_faq:'FAQ', nav_cta:'Create my bio',
      hero_eyebrow:'For creators, streamers & artists',
      hero_title:'Your link in bio that also takes tips',
      hero_sub:'Build your link page in 1 minute: your links, your bio, and your tip jar with PayPal and USDT. Free forever — and TipBio never touches a cent of your tips.',
      hero_cta1:'Create my bio free', hero_cta2:'See example',
      hero_note:'No account · No fees · Your link is encoded in the URL',
      features_title:'Everything you need in one link',
      f1_title:'Unlimited links', f1_text:'Add all your links with optional emoji: YouTube, Twitch, store, Spotify, anything. Updates are instant.',
      f2_title:'Tip jar 100% yours', f2_text:'Connect YOUR PayPal.me and YOUR USDT address (BSC network). Tips go straight to you — TipBio takes no cut and never touches them.',
      f3_title:'Premium-looking themes', f3_text:'2 free themes and 6 PRO themes. Live preview inside a phone frame as you edit.',
      f4_title:'Share with link or QR', f4_text:'Your bio lives in a short link with QR included. Drop it in your Instagram, TikTok, Twitch bio or anywhere.',
      rails_title:'Payment rails',
      rails_disclaimer:'⚠️ These rails belong to Chachi and are only for buying TipBio PRO. Tips from your tip jar go 100% to YOUR own accounts, set up in the builder.',
      copy:'Copy', copied:'Copied!',
      pricing_title:'One simple price, forever',
      free_title:'Free', pro_title:'PRO', pro_per:'one-time', pro_badge:'Recommended',
      free_l1:'✅ Unlimited links', free_l2:'✅ Tip jar with your PayPal & USDT', free_l3:'✅ 2 themes', free_l4:'✅ Shareable link + QR', free_l5:'🏷️ "Made with TipBio by Chachi" badge',
      free_cta:'Start free',
      pro_l1:'✅ Everything in free', pro_l2:'✅ 6 premium themes', pro_l3:'✅ No badge — clean, your brand', pro_l4:'✅ Priority support',
      pro_cta:'Unlock PRO',
      faq_title:'Frequently asked questions',
      q1:'Does TipBio take a cut of my tips?', a1:'No. Zero fees. The tip jar uses your own PayPal.me link and your own USDT address — money goes straight to you and TipBio never touches or sees it.',
      q2:'Do I need an account?', a2:'No. Everything runs in your browser: build your bio, generate your link, share it. Your bio is encoded inside the link itself.',
      q3:'How do I get PRO?', a3:'US$19 one-time. Pay with USDT (BSC network) and verify your transaction automatically, or with PayPal by writing to chachiafk@gmail.com to receive your manual activation code.',
      q4:'Where is my data stored?', a4:'In the link itself: your bio is encoded in the URL. No database, no tracking, no account to hack.',
      q5:'Can I change my bio later?', a5:'Yes. Come back to the builder, edit anything, and generate a new link. Old links keep working with the version they had.',
      builder_title:'Bio builder',
      builder_sub:'Fill in your profile and watch it live. The tip jar is 100% yours: use YOUR PayPal.me and YOUR USDT address.',
      sec_profile:'👤 Profile', sec_links:'🔗 Links', sec_tip:'💸 Tip jar (100% yours)', sec_theme:'🎨 Theme',
      lbl_name:'Name', lbl_handle:'@handle', lbl_photo:'Photo (URL)', lbl_bio:'Short bio',
      ph_name:'Your name or nickname', ph_handle:'@yourhandle', ph_photo:'https://…/your-photo.jpg', ph_bio:'Streamer · Music · What you do in one line',
      add_link:'+ Add link', link_emoji:'😀', link_text:'Link text', link_url:'https://…',
      tip_note:'⚠️ Use YOUR own accounts. Tips go straight to you — TipBio takes no cut.',
      lbl_paypal:'Your PayPal.me', lbl_usdt:'Your USDT (BSC network / BEP-20)',
      ph_paypal:'https://paypal.me/youruser', ph_usdt:'0xYourAddress…',
      unlock_pro:'Unlock PRO — US$19',
      pro_active:'✅ PRO active — 8 themes unlocked, no badge.',
      pro_locked:'🔒 6 premium themes locked.',
      premium_only:'PRO theme — unlock it to use it',
      generate:'Generate my link', share_title:'🎉 Your bio is ready',
      copy_link:'Copy link', show_qr:'Show QR',
      qr_fail:'Could not load the QR (check your connection).', retry:'Retry',
      preview:'Live preview',
      pro_modal_title:'Unlock TipBio PRO — US$19 one-time',
      pro_rails_note:'⚠️ These rails belong to Chachi (PRO purchase). Your builder tip jar stays 100% yours.',
      pay_usdt_title:'Option 1 · USDT (BSC network) — automatic verification',
      pay_usdt_1:'Send ≥ 19 USDT (BEP-20) to:',
      pay_usdt_2:'Paste the transaction hash:',
      ph_tx:'0x…', verify_pay:'Verify payment',
      pay_pp_title:'Option 2 · PayPal — manual code',
      pay_pp_1:'Send US$19 via PayPal to chachiafk@gmail.com and forward your receipt to the same email.',
      pay_pp_2:'You will receive an activation code. Enter it with your email:',
      ph_email:'you@email.com', ph_code:'16-character code', activate:'Activate PRO',
      tip_title:'💸 Support me with a tip',
      no_tip:'The creator has not set up their tip jar yet.',
      badge:'Made with <a href="'+PUBLIC_BASE+'">TipBio</a> by Chachi',
      footer_made:'Made with ⚡ for creators',
      msg_verifying:'Verifying on-chain…', msg_notfound:'Transaction not found or no RPC answered. Check the hash and try again.',
      msg_badhash:'That hash does not look valid (0x + 64 hex format).',
      msg_low:'That transaction did not send ≥ 19 USDT to the payment address.',
      msg_ok:'✅ Payment verified! PRO unlocked.',
      msg_code_ok:'✅ Valid code! PRO unlocked.',
      msg_code_bad:'Wrong code or email. Check and try again.',
      msg_nosubtle:'Your browser cannot verify the code here (secure context required).',
      default_name:'Your Name', default_bio:'My bio in one line ✨'
    }
  };
  let lang = localStorage.getItem('tipbio_lang') || 'es';
  const t = k => (I18N[lang] && I18N[lang][k]) || I18N.es[k] || k;
  function applyI18n(){
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-lang-btn]').forEach(b => b.classList.toggle('active', b.dataset.langBtn === lang));
    renderThemePicker(); renderPreview(); updateProUI();
  }
  document.querySelectorAll('[data-lang-btn]').forEach(b =>
    b.addEventListener('click', () => { lang = b.dataset.langBtn; localStorage.setItem('tipbio_lang', lang); applyI18n(); })
  );

  /* ---------- utilidades ---------- */
  function copyText(txt, btn){
    const done = () => { if (btn){ const old = btn.textContent; btn.textContent = t('copied'); setTimeout(() => btn.textContent = old, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done){
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e){}
    document.body.removeChild(ta);
  }
  document.querySelectorAll('.copy-btn').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy, b)));
  function esc(s){ return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---------- PRO ---------- */
  function isPro(){ return localStorage.getItem('tipbio_pro') === '1'; }
  function setPro(){ localStorage.setItem('tipbio_pro', '1'); updateProUI(); renderThemePicker(); renderPreview(); }

  /* ---------- estado del constructor ---------- */
  const state = {
    name:'', handle:'', photo:'', bio:'',
    links:[{ emoji:'▶️', text:'', url:'' }],
    paypal:'', usdt:'', theme:'t-neon'
  };

  /* ---------- render del bio card ---------- */
  function renderBioCard(data, target){
    const theme = THEMES.find(x => x.id === data.theme) || THEMES[0];
    const showBadge = !data.pro;
    const name = esc(data.name) || esc(t('default_name'));
    const handle = data.handle ? '<div class="bio-handle">' + esc(data.handle.startsWith('@') ? data.handle : '@' + data.handle) + '</div>' : '';
    const photo = data.photo
      ? '<img class="bio-photo" src="' + esc(data.photo) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="bio-photo-fallback">👤</div>';
    const desc = data.bio ? '<p class="bio-desc">' + esc(data.bio) + '</p>' : '<p class="bio-desc">' + esc(t('default_bio')) + '</p>';
    const links = (data.links || []).filter(l => l.text || l.url).map(l => {
      const url = esc(l.url || '#');
      const txt = esc(l.text) || esc(l.url || '');
      const em = l.emoji ? '<span>' + esc(l.emoji) + '</span>' : '';
      return '<a class="bio-link" href="' + url + '" target="_blank" rel="noopener">' + em + '<span>' + txt + '</span></a>';
    }).join('');
    let tip = '';
    const hasPaypal = !!(data.paypal && data.paypal.trim());
    const hasUsdt = !!(data.usdt && data.usdt.trim());
    if (hasPaypal || hasUsdt){
      tip = '<div class="bio-tip"><div class="bio-tip-title">' + esc(t('tip_title')) + '</div><div class="tip-buttons">';
      if (hasPaypal) tip += '<a class="tip-btn" href="' + esc(data.paypal.trim()) + '" target="_blank" rel="noopener">🅿️ PayPal</a>';
      if (hasUsdt) tip += '<button type="button" class="tip-btn tip-copy-addr" data-addr="' + esc(data.usdt.trim()) + '">💠 USDT BSC</button>';
      tip += '</div>';
      if (hasUsdt) tip += '<div class="tip-addr"><span class="mono">' + esc(data.usdt.trim()) + '</span><button type="button" class="tip-copy-addr" data-addr="' + esc(data.usdt.trim()) + '">' + esc(t('copy')) + '</button></div>';
      tip += '</div>';
    } else {
      tip = '<div class="bio-tip"><div class="bio-tip-title">' + esc(t('tip_title')) + '</div><p class="bio-desc">' + esc(t('no_tip')) + '</p></div>';
    }
    const badge = showBadge ? '<div class="bio-badge">' + t('badge') + '</div>' : '';
    target.className = 'bio-card ' + theme.id;
    target.innerHTML = photo + '<div><div class="bio-name">' + name + '</div>' + handle + '</div>' + desc +
      (links ? '<div class="bio-links">' + links + '</div>' : '') + tip + badge;
    target.querySelectorAll('.tip-copy-addr').forEach(b => b.addEventListener('click', () => copyText(b.dataset.addr, b)));
  }

  /* ---------- preview en vivo ---------- */
  function readForm(){
    state.name = document.getElementById('f-name').value.trim();
    state.handle = document.getElementById('f-handle').value.trim();
    state.photo = document.getElementById('f-photo').value.trim();
    state.bio = document.getElementById('f-bio').value.trim();
    state.paypal = document.getElementById('f-paypal').value.trim();
    state.usdt = document.getElementById('f-usdt').value.trim();
    state.links = [];
    document.querySelectorAll('#links-list .link-row').forEach(row => {
      state.links.push({
        emoji: row.querySelector('.emoji').value.trim(),
        text: row.querySelector('.ltext').value.trim(),
        url: row.querySelector('.lurl').value.trim()
      });
    });
  }
  function renderPreview(){ renderBioCard(Object.assign({}, state, { pro: isPro() }), document.getElementById('phone-preview')); }

  /* ---------- lista de enlaces ---------- */
  function addLinkRow(emoji, text, url){
    const list = document.getElementById('links-list');
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML =
      '<input type="text" class="emoji" maxlength="4" value="' + esc(emoji || '') + '" placeholder="' + esc(t('link_emoji')) + '">' +
      '<div class="grow"><input type="text" class="ltext" maxlength="60" value="' + esc(text || '') + '" placeholder="' + esc(t('link_text')) + '">' +
      '<input type="url" class="lurl" value="' + esc(url || '') + '" placeholder="' + esc(t('link_url')) + '"></div>' +
      '<button type="button" class="link-remove" aria-label="×">×</button>';
    row.querySelector('.link-remove').addEventListener('click', () => { row.remove(); readForm(); renderPreview(); });
    row.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { readForm(); renderPreview(); }));
    list.appendChild(row);
  }
  document.getElementById('add-link').addEventListener('click', () => { addLinkRow('', '', ''); readForm(); renderPreview(); });

  /* ---------- temas ---------- */
  function renderThemePicker(){
    const picker = document.getElementById('theme-picker');
    picker.innerHTML = '';
    THEMES.forEach(th => {
      const locked = th.premium && !isPro();
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'theme-swatch' + (state.theme === th.id ? ' selected' : '') + (locked ? ' locked' : '');
      d.innerHTML = (locked ? '<span class="lock">🔒</span>' : '') + '<span class="dot" style="background:' + th.dot + '"></span>' + esc(lang === 'es' ? th.es : th.en);
      d.title = locked ? t('premium_only') : '';
      d.addEventListener('click', () => { if (locked) { openPro(); return; } state.theme = th.id; renderThemePicker(); renderPreview(); });
      picker.appendChild(d);
    });
  }
  function updateProUI(){
    const el = document.getElementById('pro-status');
    if (el) el.textContent = isPro() ? t('pro_active') : t('pro_locked');
    const b2 = document.getElementById('open-pro-2');
    if (b2) b2.style.display = isPro() ? 'none' : '';
  }

  /* ---------- generar link + QR ---------- */
  function buildShareUrl(){
    const data = { v:1, name: state.name, handle: state.handle, photo: state.photo, bio: state.bio,
      links: state.links.filter(l => l.text || l.url), paypal: state.paypal, usdt: state.usdt,
      theme: state.theme, pro: isPro(), lang: lang };
    return PUBLIC_BASE + '#b=' + encodeBio(data);
  }
  function setQr(img, fallback, url){
    fallback.hidden = true; img.style.display = '';
    img.onerror = () => { img.style.display = 'none'; fallback.hidden = false; };
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(url);
  }
  document.getElementById('generate-link').addEventListener('click', () => {
    readForm();
    const url = buildShareUrl();
    const panel = document.getElementById('share-panel');
    panel.hidden = false;
    document.getElementById('share-url').value = url;
    setQr(document.getElementById('share-qr'), document.getElementById('qr-fallback'), url);
    panel.scrollIntoView({ behavior:'smooth', block:'center' });
  });
  document.getElementById('copy-share').addEventListener('click', function(){
    copyText(document.getElementById('share-url').value, this);
  });
  document.getElementById('qr-retry').addEventListener('click', () => {
    setQr(document.getElementById('share-qr'), document.getElementById('qr-fallback'), document.getElementById('share-url').value);
  });

  /* ---------- inputs del formulario ---------- */
  ['f-name','f-handle','f-photo','f-bio','f-paypal','f-usdt'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => { readForm(); renderPreview(); });
  });

  /* ---------- modal PRO ---------- */
  const modal = document.getElementById('pro-modal');
  function openPro(){ modal.hidden = false; }
  function closePro(){ modal.hidden = true; }
  document.getElementById('open-pro').addEventListener('click', openPro);
  document.getElementById('open-pro-2').addEventListener('click', openPro);
  document.getElementById('close-pro').addEventListener('click', closePro);
  modal.addEventListener('click', e => { if (e.target === modal) closePro(); });

  function setMsg(id, cls, text){
    const el = document.getElementById(id);
    el.className = 'verify-msg ' + cls; el.textContent = text;
  }
  document.getElementById('verify-tx').addEventListener('click', async () => {
    const h = document.getElementById('tx-hash').value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)){ setMsg('tx-msg','err', t('msg_badhash')); return; }
    setMsg('tx-msg','busy', t('msg_verifying'));
    try {
      const r = await verifyTxOnChain(h);
      if (r.ok){ setPro(); setMsg('tx-msg','ok', t('msg_ok')); }
      else if (r.reason === 'notfound'){ setMsg('tx-msg','err', t('msg_notfound')); }
      else { setMsg('tx-msg','err', t('msg_low')); }
    } catch (e){ setMsg('tx-msg','err', t('msg_notfound')); }
  });
  document.getElementById('verify-code').addEventListener('click', async () => {
    const email = document.getElementById('pp-email').value;
    const code = document.getElementById('pp-code').value;
    setMsg('code-msg','busy', t('msg_verifying'));
    try {
      if (await verifyProCode(email, code)){ setPro(); setMsg('code-msg','ok', t('msg_code_ok')); }
      else setMsg('code-msg','err', t('msg_code_bad'));
    } catch (e){ setMsg('code-msg','err', t('msg_nosubtle')); }
  });

  /* ---------- modo vista (hash #b=...) ---------- */
  function enterViewMode(b64){
    const data = decodeBio(b64);
    if (!data) return false;
    document.getElementById('landing').hidden = true;
    document.querySelector('.builder-section').hidden = true;
    document.querySelector('.site-header .site-nav').style.display = 'none';
    const view = document.getElementById('view');
    view.hidden = false;
    if (data.lang && I18N[data.lang]){ lang = data.lang; localStorage.setItem('tipbio_lang', lang); }
    renderBioCard(data, document.getElementById('view-bio'));
    document.getElementById('copy-view-link').addEventListener('click', function(){ copyText(location.href, this); });
    const qrWrap = document.getElementById('view-qr');
    document.getElementById('view-qr-toggle').addEventListener('click', e => {
      e.preventDefault();
      qrWrap.hidden = !qrWrap.hidden;
      if (!qrWrap.hidden) setQr(document.getElementById('view-qr-img'), document.getElementById('view-qr-fallback'), location.href);
    });
    document.getElementById('view-qr-retry').addEventListener('click', () => {
      setQr(document.getElementById('view-qr-img'), document.getElementById('view-qr-fallback'), location.href);
    });
    applyI18nStaticOnly();
    window.scrollTo(0, 0);
    return true;
  }
  function applyI18nStaticOnly(){
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
    document.querySelectorAll('[data-lang-btn]').forEach(b => b.classList.toggle('active', b.dataset.langBtn === lang));
  }

  /* ---------- demo de ejemplo ---------- */
  document.getElementById('demo-link').addEventListener('click', e => {
    e.preventDefault();
    const sample = { v:1, name:'Chachi Demo', handle:'@chachi.demo',
      photo:'', bio: lang === 'es' ? 'Streamer · Creo contenido y recibo propinas ✨' : 'Streamer · I create content and take tips ✨',
      links:[ { emoji:'▶️', text:'YouTube', url:'https://youtube.com' }, { emoji:'🎮', text:'Twitch', url:'https://twitch.tv' } ],
      paypal:'https://paypal.me/ejemplo', usdt:'0x0000000000000000000000000000000000000000',
      theme:'t-neon', pro:false, lang: lang };
    location.hash = '#b=' + encodeBio(sample);
  });

  /* ---------- init ---------- */
  addLinkRow('▶️', '', '');
  const m = location.hash.match(/^#b=(.+)$/);
  if (m && enterViewMode(m[1])){ /* vista pública */ }
  else { applyI18n(); }
})();
