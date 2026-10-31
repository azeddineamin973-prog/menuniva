/**
 * The snippet the restaurant owner runs in their own browser, on their own Glovo store page,
 * to capture their menu.
 *
 * Why this exists instead of a server-side crawler: a Glovo store page contains no menu in the
 * HTML it serves to a server (the page is marked `noindex, nofollow, nocache` and the menu
 * endpoint rejects requests that carry no app session). The owner's browser, already on their
 * own store page, is the one place where the full menu legitimately exists. The snippet reads
 * what that page has already loaded and puts it on the clipboard.
 *
 * It only reads: it sends nothing anywhere, touches no cookie or credential, and stores its
 * result in the tab's own sessionStorage. The owner pastes the result into MenuNiva.
 */

export const GLOVO_CAPTURE_VERSION = 1;

/** Marker that the server-side parser uses to recognise a capture. */
export const GLOVO_CAPTURE_SOURCE = 'menuniva-glovo-capture';

export const GLOVO_CAPTURE_SNIPPET = `/* MenuNiva · capture my Glovo menu · reads this page only, sends nothing */
(() => {
  const KEY = 'menuniva.glovo.capture', MAX = 3500000;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || null } catch (e) { return null } };
  const st = read() || { source: '${GLOVO_CAPTURE_SOURCE}', version: ${GLOVO_CAPTURE_VERSION}, url: location.href, capturedAt: new Date().toISOString(), collections: [], raw: [] };
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(st)) } catch (e) {} };
  const size = () => { try { return JSON.stringify(st).length } catch (e) { return MAX } };

  /* 1. Remember the menu payloads this page loads (they carry sizes and extras). */
  const keep = (url, body) => {
    try {
      if (!/glovoapp\\.com/.test(String(url)) || typeof body !== 'string') return;
      if (body.length < 200 || body.length > 2000000 || !/"(name|title)"/.test(body) || !/pric/i.test(body)) return;
      const json = JSON.parse(body);
      if (st.raw.length >= 40 || size() > MAX) return;
      st.raw.push(json); save();
    } catch (e) {}
  };
  if (!window.__menunivaHooked) {
    window.__menunivaHooked = true;
    const f = window.fetch;
    window.fetch = function () {
      const args = arguments, u = (args[0] && args[0].url) || args[0];
      return f.apply(this, args).then((r) => { try { r.clone().text().then((t) => keep(u, t)).catch(() => {}) } catch (e) {} return r });
    };
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__mnUrl = u; return open.apply(this, arguments) };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => { try { keep(this.__mnUrl, this.responseText) } catch (e) {} });
      return send.apply(this, arguments);
    };
  }

  /* 2. Read the menu that is already on screen. */
  const PRICE = /(?:\\d{1,4}[.,]\\d{2}\\s*€)|(?:€\\s*\\d{1,4}[.,]\\d{2})/;
  const BADGE = /^(\\d+%|-\\d+%|popular|novo|new|top|promo|oferta|bestseller|mais vendido|\\d+(\\.\\d+)?\\s*(km|min|★|⭐))/i;
  const txt = (el) => ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim();
  const headingOf = (el) => {
    const all = document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]');
    let best = null;
    for (const h of all) { const p = h.compareDocumentPosition(el); if (p & Node.DOCUMENT_POSITION_FOLLOWING) best = h; }
    const t = best ? txt(best) : '';
    return t && t.length <= 60 ? t : '';
  };
  const harvest = () => {
    const tiles = new Set(), rows = [];
    document.querySelectorAll('img, [style*=background-image]').forEach((img) => {
      let el = img, up = 0;
      while (el && up++ < 6) {
        const t = txt(el);
        if (t && t.length < 500 && PRICE.test(t)) { tiles.add(el); return }
        el = el.parentElement;
      }
    });
    /* Dishes without a photo: smallest block that shows a price. */
    document.querySelectorAll('li,article,[data-test-id],[class*=product],[class*=tile],[class*=card]').forEach((el) => {
      const t = txt(el);
      if (!t || t.length > 400 || !PRICE.test(t)) return;
      if ([...tiles].some((x) => x.contains(el) || el.contains(x))) return;
      tiles.add(el);
    });
    tiles.forEach((tile) => {
      const leaves = [...tile.querySelectorAll('*')].filter((e) => !e.children.length && txt(e)).map((e) => txt(e));
      const flat = txt(tile);
      const priceM = flat.match(PRICE);
      if (!priceM) return;
      const price = priceM[0];
      const words = leaves.length ? leaves : flat.split(/\\s{2,}/);
      const clean = words.filter((w) => w && !PRICE.test(w) && !BADGE.test(w) && w.length > 1 && w.length < 300);
      if (!clean.length) return;
      const name = clean[0];
      const rest = clean.slice(1).filter((w) => w !== name);
      const img = tile.querySelector('img');
      const bg = !img ? (tile.querySelector('[style*=background-image]') || {}).style : null;
      const src = img ? img.currentSrc || img.src : bg ? (String(bg.backgroundImage).match(/url\\(["']?([^"')]+)/) || [])[1] : null;
      rows.push({
        name: name.slice(0, 120),
        description: rest.length ? rest.join(' ').slice(0, 1000) : undefined,
        price: price,
        imageUrl: src && /^https?:/.test(src) ? src : undefined,
        soldOut: /esgotado|sold out|indispon|unavailable|agotado|rupture/i.test(flat) || undefined,
        category: headingOf(tile),
      });
    });
    const byCat = new Map();
    rows.forEach((r) => {
      const k = r.category || '';
      if (!byCat.has(k)) byCat.set(k, []);
      const list = byCat.get(k);
      if (!list.some((x) => x.name === r.name && x.price === r.price)) list.push({ name: r.name, description: r.description, price: r.price, imageUrl: r.imageUrl, soldOut: r.soldOut });
    });
    st.collections = [...byCat.entries()].map(([title, products]) => ({ title: title || undefined, products }));
    save();
  };

  const count = () => st.collections.reduce((n, c) => n + c.products.length, 0);
  const copy = () => {
    harvest();
    const out = JSON.stringify(st);
    const done = () => console.log('%c✅ MenuNiva: ' + count() + ' dishes on screen + ' + st.raw.length + ' menu payloads copied (' + Math.round(out.length / 1024) + ' KB). Paste it into MenuNiva now.', 'color:#1F5C4A;font-weight:bold');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(out).then(done, () => { window.__menunivaResult = out; console.log('Clipboard blocked. Run: copy(__menunivaResult)') });
    else { window.__menunivaResult = out; console.log('Run: copy(__menunivaResult)') }
    return count();
  };
  window.__menuniva = { copy: copy, harvest: harvest, state: () => st, reset: () => { sessionStorage.removeItem(KEY); location.reload() } };

  harvest();
  console.log('%cMenuNiva capture is running.', 'color:#1F5C4A;font-weight:bold');
  console.log('1) Scroll through your whole menu so every section loads.');
  console.log('2) Then type:  __menuniva.copy()');
  console.log('Found so far: ' + count() + ' dishes on screen.');
})();`;

/** One place for the on-screen instructions, so the UI and the docs cannot drift apart. */
export const GLOVO_CAPTURE_STEPS = [
  'Open your Glovo store page in this browser and make sure your menu is visible.',
  'Open the developer console: ⌥⌘J on macOS, Ctrl+Shift+J on Windows. In Chrome, the first paste needs you to type "allow pasting" and press Enter.',
  'Paste the capture snippet and press Enter.',
  'Scroll through your whole menu so every section loads, then type __menuniva.copy() and press Enter.',
  'Come back here and paste the result into the box below.',
] as const;
