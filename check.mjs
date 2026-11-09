// Scans all current Rossmann.pl promotions, matches them against watchlist.json,
// sends push notifications (ntfy) when a watched product goes on sale and when the sale is about to end.
import fs from 'node:fs/promises';

const SITE = 'https://www.rossmann.pl';
const API = `${SITE}/productscatalog/api/v1/Catalog`;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const ENDING_DAYS = 2; // send "ending" reminder this many days before promotion end
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pl-PL,pl;q=0.9',
  'Referer': `${SITE}/promocje`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
};
export const norm = s => (s || '').toLowerCase().replace(/ł/g, 'l')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const todayWarsaw = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const plDate = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '?';
const zl = n => n == null ? '' : `${n.toFixed(2).replace('.', ',')} zł`;

// Multi-buy deals (1+1 etc.) have no promotionTo — the dates are only in the description text.
export function endFromDescription(text) {
  let best = null;
  for (const m of (text || '').matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g)) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!best || iso > best) best = iso;
  }
  return best;
}

export function slim(i) {
  const pic = i.pictures?.find(p => p.type === 'Product') || i.pictures?.[0];
  return {
    id: i.id,
    brand: (i.brand || '').trim(),
    name: [i.name, i.caption].map(s => (s || '').trim()).filter(Boolean).join(' '),
    unit: i.unit || '',
    price: i.price ?? null,
    oldPrice: i.oldPrice ?? null,
    from: i.promotionFrom?.slice(0, 10) ?? null,
    to: i.promotionTo?.slice(0, 10) ?? endFromDescription(i.cmpDescription),
    deal: i.cmpDescription ? i.cmpDescription.slice(0, 220) : null,
    badge: (i.badges || []).map(b => b.name).filter(Boolean).join(', ') || null,
    url: SITE + i.navigateUrl,
    img: pic?.medium || null,
  };
}

export function matches(w, p) {
  if (w.id) return Number(w.id) === p.id;
  const terms = norm(w.query).split(' ').filter(Boolean);
  if (!terms.length) return false;
  const hay = norm(`${p.brand} ${p.name}`);
  return terms.every(t => hay.includes(t));
}

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url} → ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
}

async function fetchAllPromos() {
  const byId = new Map();
  let page = 1, totalPages = 1;
  do {
    const url = `${API}?banners=false&deviceType=desktop&page=${page}&pageSize=96&promotionTags=promotion&search=&sortOrder=default`;
    const data = await getJson(url);
    totalPages = data.totalPages || 1;
    for (const i of data.items || []) if (i.type === 'Product' && i.id) byId.set(i.id, slim(i));
    page++;
    await sleep(350);
  } while (page <= totalPages);
  return [...byId.values()];
}

async function notify({ title, message, click, tags }) {
  if (!NTFY_TOPIC) { console.log(`[notify] ${title} — ${message}`); return; }
  const r = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: NTFY_TOPIC, title, message, click, tags }),
  });
  if (!r.ok) console.error('ntfy failed', r.status, await r.text());
}

const priceLine = p => p.oldPrice
  ? `${zl(p.price)} (było ${zl(p.oldPrice)}, -${Math.round((1 - p.price / p.oldPrice) * 100)}%)`
  : (p.deal ? p.deal.split('.')[0] : zl(p.price));

export async function run({ fetchPromos = fetchAllPromos, dir = '.' } = {}) {
  const watchlist = await readJson(`${dir}/watchlist.json`, []);
  const state = await readJson(`${dir}/state.json`, { started: {}, ending: {} });
  const today = todayWarsaw();

  const promos = await fetchPromos();
  if (promos.length < 100) throw new Error(`Only ${promos.length} promos fetched — looks like a block/outage, not saving.`);

  const hits = new Map(); // productId -> product
  for (const w of watchlist) for (const p of promos) if (matches(w, p)) hits.set(p.id, p);

  let sent = 0;
  for (const p of hits.values()) {
    const key = `${p.id}|${p.to || 'nodate'}`;
    const title = `${p.brand} ${p.name}`.slice(0, 90);
    const left = p.to ? daysBetween(today, p.to) : null;
    if (left != null && left < 0) continue; // already over
    const endingSoon = left != null && left <= ENDING_DAYS;
    if (endingSoon && !state.ending[key]) {
      await notify({ title: `⏰ Promo się kończy: ${title}`, message: `${priceLine(p)} · koniec ${plDate(p.to)}`, click: p.url, tags: ['hourglass'] });
      state.ending[key] = state.started[key] = state.started[key] || today; sent++;
    } else if (!state.started[key]) {
      await notify({ title: `🔥 Promo: ${title}`, message: `${priceLine(p)} · do ${plDate(p.to)}`, click: p.url, tags: ['shopping_cart'] });
      state.started[key] = today; sent++;
    }
  }

  // forget promos that are no longer running
  const live = new Set(promos.map(p => `${p.id}|${p.to || 'nodate'}`));
  for (const bucket of [state.started, state.ending]) for (const k of Object.keys(bucket)) if (!live.has(k)) delete bucket[k];

  await fs.writeFile(`${dir}/state.json`, JSON.stringify(state, null, 1) + '\n');
  await fs.mkdir(`${dir}/site`, { recursive: true });
  await fs.writeFile(`${dir}/site/promos.json`, JSON.stringify({ updatedAt: new Date().toISOString(), items: promos }));
  await fs.writeFile(`${dir}/site/watchlist.json`, JSON.stringify(watchlist, null, 1));
  console.log(`${promos.length} promos, ${hits.size} watched on sale, ${sent} notifications sent`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch(e => { console.error(e); process.exit(1); });
}
