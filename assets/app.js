// Building footprints by county: map view, sorted view, stats, poster export.
// Data: data/index.json + data/counties/<slug>.json (see scripts/prep_buildings_arcpy.py).
// Text, colors and defaults: assets/config.js.

"use strict";

const CFG = window.CONFIG || {};
const T = CFG.text || {};
const SQFT = 10.7639;      // ft² per m²
const FT = 3.28084;        // ft per m (scale bar)
const SQMI = 2589988.11;   // m² per sq mi

const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d"), stage = $("stage");

let IDX = null;            // data/index.json
let cur = null;            // prepared county
const cache = {};
let view = CFG.defaultView || "map";
let anim = 0;              // 0 = map, 1 = sorted
let layout = null;
let hover = -1;
let selected = -1;         // index into cur.B of the clicked building (map view)
let miniSel = -1;          // building shown in the mini-map (sorted view)
const water = {};          // slug -> { areas, rivers } from data/water/<slug>.json (optional)
let RANKS = null;          // data/ranks.json, decoded: per class, every CRC building's area ×10, largest first
let active = null;         // Set of class indices shown at full strength (null = all)
let zoom = { k: 1, x: 0, y: 0 };
let pathCache = null;
const opts = {
  group: CFG.defaultGroup !== false,
  align: CFG.defaultAlign !== false,
  show: ["all", "largest", "smallest"].includes(CFG.defaultShow) ? CFG.defaultShow : "all",
  n: Math.max(1, Math.round(CFG.defaultN || 500))
};

// ── helpers ─────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
// Put config text in an element; empty → visible [placeholder]
function put(el, value, name, html) {
  if (!el) return;
  el.classList.toggle("ph", !value);
  if (!value) el.textContent = `[${name}]`;
  else if (html) el.innerHTML = value;
  else el.textContent = value;
}
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x) => `${fmt(x * 100, x < 0.1 ? 1 : 0)}%`;
const className = (i) => (CFG.classLabels || {})[IDX.classes[i]] || IDX.classes[i];
const classColor = (i) => (CFG.classColors || {})[IDX.classes[i]] || "#888888";
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const dpr = () => window.devicePixelRatio || 1;

function fillTokens(tpl, s) {
  const tokens = {
    count: fmt(s.count),
    footprint: fmt(s.foot / SQMI, 2),
    land: fmt(s.land / SQMI, 0),
    share: pct(s.foot / s.land),
    median: fmt(s.median * SQFT),
    top1: pct(s.top1),
    smallHalf: pct(s.smallHalf)
  };
  // ACS census numbers (scripts/add_census.py); "–" when a table wasn't added
  const c = s.census || {};
  const num = (v, d = 0) => (v == null ? "–" : fmt(v, d));
  const money = (v) => (v == null ? "–" : "$" + fmt(v));
  const per = (v) => (v == null ? "–" : pct(v));
  const resBuildings = s.tc ? s.tc[0] : null;
  Object.assign(tokens, {
    population: num(c.population),
    housingUnits: num(c.housingUnits),
    peoplePerBuilding: c.population && s.count ? fmt(c.population / s.count, 1) : "–",
    unitsPerHome: c.housingUnits && resBuildings ? fmt(c.housingUnits / resBuildings, 2) : "–",
    medianYearBuilt: c.medianYearBuilt == null ? "–" : String(c.medianYearBuilt),
    medianHomeValue: money(c.medianHomeValue),
    medianIncome: money(c.medianIncome),
    pctVacant: per(c.pctVacant),
    pctOwner: per(c.pctOwner),
    pctRenter: per(c.pctRenter),
    pctSingleFamily: per(c.pctSingleFamily),
    pctMultiFamily: per(c.pctMultiFamily),
    pctMobileHome: per(c.pctMobileHome)
  });
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
}

// ── theme + static text ─────────────────────────────────────────
function applyConfig() {
  const th = CFG.theme || {};
  const root = document.documentElement.style;
  const map = { bg: "--bg", panel: "--panel", line: "--line", text: "--text", sub: "--sub", muted: "--muted",
    accent: "--accent", countyOutline: "--outline", font: "--font" };
  for (const [k, v] of Object.entries(map)) if (th[k]) root.setProperty(v, th[k]);

  document.title = T.pageTitle || T.title || "[pageTitle]";
  put($("title"), T.title, "title");
  put($("subtitle"), T.subtitle, "subtitle");
  put($("intro"), T.intro, "intro", true);
  put($("footer"), T.footer, "footer", true);
  // links in config text open in a new tab
  document.querySelectorAll("#intro a, #footer a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  const back = T.backLink || {};
  $("backLink").href = back.url || "#";
  put($("backLink"), back.label ? `← ${back.label}` : "", "backLink.label");

  const tabs = T.tabs || {}, c = T.controls || {};
  put($("tabMap"), tabs.map, "tabs.map");
  put($("tabSorted"), tabs.sorted, "tabs.sorted");
  put($("tabStats"), tabs.stats, "tabs.stats");
  put($("lblGroup"), c.group, "controls.group");
  put($("lblAlign"), c.align, "controls.align");
  put($("lblShow"), c.show, "controls.show");
  put($("lblN"), c.n, "controls.n");
  $("lblShowAll").textContent = c.showAll || "[showAll]";
  $("lblShowLargest").textContent = c.showLargest || "[showLargest]";
  $("lblShowSmallest").textContent = c.showSmallest || "[showSmallest]";
  put($("resetView"), c.reset, "controls.reset");
  put($("savePoster"), c.poster, "controls.poster");

  $("optGroup").checked = opts.group;
  $("optAlign").checked = opts.align;
  $("optShow").value = opts.show;
  $("optN").value = opts.n;
  $("nWrap").hidden = opts.show === "all";
}

function message(text) {
  const m = $("message");
  m.textContent = text || "";
  m.classList.toggle("show", !!text);
}

// ── data ────────────────────────────────────────────────────────
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { c: h.get("c"), v: h.get("v") };
}
function writeHash() {
  if (cur) history.replaceState(null, "", `#c=${cur.slug}&v=${view}`);
}

async function start() {
  applyConfig();
  try {
    const r = await fetch("data/index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    IDX = await r.json();
  } catch (e) {
    message("data/index.json was not found. Run scripts/prep_buildings_arcpy.py in ArcGIS Pro to create the data files.");
    return;
  }
  buildPicker();
  buildLegend();
  const h = readHash();
  if (["map", "sorted", "stats"].includes(h.v)) view = h.v;
  const slugs = IDX.counties.map((c) => c.slug);
  const first = slugs.includes(h.c) ? h.c : slugs.includes(CFG.defaultCounty) ? CFG.defaultCounty : slugs[0];
  await load(first);
}

async function load(slug) {
  message("Loading…");
  try {
    if (!cache[slug]) {
      const r = await fetch(`data/counties/${slug}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      cache[slug] = prep(await r.json());
    }
    if (!(slug in water)) water[slug] = await loadWater(slug, cache[slug].H);
  } catch (e) {
    message(`data/counties/${slug}.json could not be loaded.`);
    return;
  }
  message("");
  cur = cache[slug];
  hover = -1;
  closeSelection();
  setMini(-1);
  zoom = { k: 1, x: 0, y: 0 };
  layout = null;
  pathCache = null;
  $("countySelect").value = slug;
  document.querySelectorAll("#picker path").forEach((p) => p.classList.toggle("on", p.dataset.slug === slug));
  const s = summary();
  $("countyName").textContent = cur.name;
  put($("facts"), T.facts ? fillTokens(T.facts, s) : "", "facts", true);
  updateLegendPresence();
  anim = view === "sorted" ? 1 : 0;
  setView(view, true);
}

const summary = () => IDX.counties.find((c) => c.slug === cur.slug);

function prep(d) {
  // World frame: metres, y down. Vertices relative to each building's centroid.
  const H = d.h, B = [];
  for (const [t, prim, area, ang, cx, cy, rings] of d.b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rs = rings.map((r) => {
      const a = new Float32Array(r.length);
      for (let i = 0; i < r.length; i += 2) {
        const x = r[i] / 10, y = -r[i + 1] / 10;
        a[i] = x; a[i + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return a;
    });
    B.push({ t, prim, area, ang: -ang, cx: cx / 10, cy: H - cy / 10, rs, x0, y0, x1, y1,
      rad: Math.max(x1 - x0, y1 - y0) });
  }
  const outline = d.outline.map((r) => {
    const a = [];
    for (let i = 0; i < r.length; i += 2) a.push(r[i], H - r[i + 1]);
    return a;
  });
  return { slug: d.slug, name: d.name, W: d.w, H, B, outline };
}

// ── picker + legend ─────────────────────────────────────────────
function buildPicker() {
  const P = IDX.pick, sv = $("picker");
  sv.setAttribute("viewBox", `0 0 ${P.w} ${P.h}`);
  sv.innerHTML = P.counties.map((c) => {
    const d = c.rings.map((r) => {
      let s = "";
      for (let i = 0; i < r.length; i += 2) s += (i ? "L" : "M") + r[i] + "," + (P.h - r[i + 1]);
      return s + "Z";
    }).join("");
    return `<path data-slug="${esc(c.slug)}" d="${d}" tabindex="0" role="button" aria-label="${esc(c.name)}"><title>${esc(c.name)}</title></path>`;
  }).join("");
  sv.addEventListener("click", (e) => { const s = e.target.dataset && e.target.dataset.slug; if (s) load(s); });
  sv.addEventListener("keydown", (e) => {
    const s = e.target.dataset && e.target.dataset.slug;
    if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); load(s); }
  });

  const sel = $("countySelect");
  sel.innerHTML = IDX.counties.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("");
  sel.onchange = () => load(sel.value);
  const step = (d) => {
    const i = IDX.counties.findIndex((c) => c.slug === cur.slug);
    load(IDX.counties[(i + d + IDX.counties.length) % IDX.counties.length].slug);
  };
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
}

function buildLegend() {
  $("legend").innerHTML = IDX.classes.map((c, i) =>
    `<button type="button" data-t="${i}" aria-pressed="true"><i style="background:${esc(classColor(i))}"></i>${esc(className(i))}</button>`
  ).join("");
  $("legend").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const t = +b.dataset.t;
    // First click isolates one class; further clicks add/remove; turning all off resets.
    if (!active) active = new Set([t]);
    else if (active.has(t)) active.delete(t);
    else active.add(t);
    if (active && (active.size === 0 || active.size === IDX.classes.length)) active = null;
    $("legend").querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(!active || active.has(+x.dataset.t))));
    draw();
  });
}

function updateLegendPresence() {
  const s = summary();
  $("legend").querySelectorAll("button").forEach((x) => { x.hidden = !s.tc[+x.dataset.t]; });
}

// ── sorted layout ───────────────────────────────────────────────
function layoutPass(labH, aspect, widthFactor = 1) {
  const B = cur.B;
  for (const b of B) {
    const th = opts.align ? -b.ang : 0, c = Math.cos(th), s = Math.sin(th);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of b.rs) for (let i = 0; i < a.length; i += 2) {
      const x = c * a[i] - s * a[i + 1], y = s * a[i] + c * a[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    let th2 = th;
    if (opts.align && y1 - y0 > x1 - x0) { th2 = th + Math.PI / 2; [x0, x1, y0, y1] = [-y1, -y0, x0, x1]; }
    b.th = th2; b.bw = x1 - x0; b.bh = y1 - y0; b.bcx = (x0 + x1) / 2; b.bcy = (y0 + y1) / 2;
  }
  // Which buildings the sorted view shows: all, or the largest / smallest N of each class.
  const byClass = new Map();
  B.forEach((b, i) => { if (!byClass.has(b.t)) byClass.set(b.t, []); byClass.get(b.t).push(i); });
  const totals = {};
  for (const [t, idx] of byClass) {
    totals[t] = idx.length;
    idx.sort((i, j) => B[j].area - B[i].area);
    const keep = opts.show === "largest" ? idx.slice(0, opts.n)
      : opts.show === "smallest" ? idx.slice(Math.max(0, idx.length - opts.n)) : idx;
    for (const i of idx) B[i].vis = false;
    for (const i of keep) B[i].vis = true;
  }
  const order = B.map((b, i) => i).filter((i) => B[i].vis);
  order.sort((i, j) => (opts.group ? B[i].t - B[j].t : 0) || B[j].area - B[i].area);

  const gap = Math.max(0.5, Math.sqrt(cur.B.reduce((s, b) => s + b.area, 0) / cur.B.length) * 0.08);
  let tot = 0;
  for (const i of order) tot += (B[i].bw + gap) * (B[i].bh + gap);
  const W = Math.sqrt(tot * 1.12 * aspect) * widthFactor;
  let x = 0, y = 0, rowH = 0, lastT = -1;
  const labels = [];
  for (const i of order) {
    const b = B[i];
    if (opts.group && b.t !== lastT) {
      if (x > 0) { y += rowH + gap; x = 0; rowH = 0; }
      y += labH + gap * 2; labels.push([b.t, y, Math.min(opts.n, totals[b.t]), totals[b.t]]); lastT = b.t;
    }
    if (x > 0 && x + b.bw > W) { x = 0; y += rowH + gap; rowH = 0; }
    b.sx = x + b.bw / 2; b.sy = y + b.bh / 2; x += b.bw + gap;
    if (b.bh > rowH) rowH = b.bh;
  }
  return { W: Math.max(W, x), H: y + rowH, labels, grp: opts.group, aspect, show: opts.show };
}

// Lay out for a drawing box; group labels need a second pass at the final scale.
function computeLayout(box, labelPx) {
  // Repack a few times so the block of rows matches the drawing box's shape.
  const aspect = (box.w - 2 * box.pad) / (box.h - 2 * box.pad);
  let factor = 1, L = null, labH = 0;
  for (let i = 0; i < 6; i++) {
    L = layoutPass(labH, aspect, factor);
    const s = Math.min((box.w - 2 * box.pad) / L.W, (box.h - 2 * box.pad) / L.H);
    if (opts.group) labH = (labelPx * 1.6) / s;
    const ratio = L.W / L.H / aspect;
    if (Math.abs(ratio - 1) < 0.03 && (!opts.group || i > 0)) break;
    factor /= Math.sqrt(ratio);
  }
  if (opts.group) L = layoutPass(labH, aspect, factor);
  return L;
}

function screenBox() {
  return { x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight, pad: 28 };
}

function fit(e, box, L) {
  const sMap = Math.min((box.w - 2 * box.pad) / cur.W, (box.h - 2 * box.pad) / cur.H);
  const sLay = L ? Math.min((box.w - 2 * box.pad) / L.W, (box.h - 2 * box.pad) / L.H) : sMap;
  const s = sMap + (sLay - sMap) * e;
  return {
    s,
    mx: box.x + (box.w - cur.W * s) / 2, my: box.y + (box.h - cur.H * s) / 2,
    lx: L ? box.x + (box.w - L.W * s) / 2 : 0, ly: L ? box.y + (box.h - L.H * s) / 2 : 0
  };
}

function place(b, f, e, L) {
  let th = 0, ox = f.mx + b.cx * f.s, oy = f.my + b.cy * f.s;
  if (e > 0 && L) {
    const tx = f.lx + (b.sx - b.bcx) * f.s, ty = f.ly + (b.sy - b.bcy) * f.s;
    th = b.th * e; ox += (tx - ox) * e; oy += (ty - oy) * e;
  }
  return [ox, oy, th];
}

// Group label in the sorted view, e.g. "Residential · largest 500 of 91,648"
function groupLabel(L, [t, , shown, total]) {
  const c = T.controls || {};
  if (L.show === "all") return className(t);
  const tpl = (L.show === "largest" ? c.largestLabel : c.smallestLabel) || "";
  const part = tpl ? tpl.replace("{n}", fmt(shown)).replace("{total}", fmt(total)) : `[${L.show}Label]`;
  return `${className(t)} · ${part}`;
}

// One Path2D per class. Footprints under ~1 px are drawn as squares of equal area.
// Buildings left out of the sorted view (largest/smallest N) go in `hidden` and fade out.
function buildPaths(f, e, L, k) {
  const paths = IDX.classes.map(() => new Path2D());
  const hidden = IDX.classes.map(() => new Path2D());
  const tiny = 0.9 / k;
  for (const b of cur.B) {
    const out = L && e > 0 && !b.vis;
    if (out && e >= 1) continue;
    const [ox, oy, th] = out ? place(b, f, 0, null) : place(b, f, e, L);
    const p = out ? hidden[b.t] : paths[b.t];
    if (b.rad * f.s < tiny) {
      // keep every building at least minPixelSize on screen so dense areas stay visible
      const side = Math.max(Math.sqrt(b.area) * f.s, (CFG.minPixelSize ?? 1) / k);
      p.rect(ox - side / 2, oy - side / 2, side, side);
      continue;
    }
    const c = Math.cos(th), sn = Math.sin(th);
    for (const a of b.rs) {
      for (let i = 0; i < a.length; i += 2) {
        const X = ox + (c * a[i] - sn * a[i + 1]) * f.s, Y = oy + (sn * a[i] + c * a[i + 1]) * f.s;
        i ? p.lineTo(X, Y) : p.moveTo(X, Y);
      }
      // No closePath(): fill() closes each ring itself, and closePath() makes
      // Chrome's path building quadratic with many subpaths.
    }
  }
  paths.hidden = hidden;
  return paths;
}

// ── drawing ─────────────────────────────────────────────────────
function renderScene(g, box, e, L, k, tx, ty, scaleOut, paths) {
  const f = fit(e, box, L);
  g.save();
  g.translate(tx, ty);
  g.scale(k, k);
  const th = CFG.theme || {};
  if (e < 1) {
    g.globalAlpha = 1 - e;
    g.strokeStyle = th.countyOutline || "#4a5060";
    g.lineWidth = Math.max(1, box.w / 1200) / k;
    g.setLineDash([4 / k, 4 / k]);
    g.beginPath();
    for (const a of cur.outline) {
      for (let i = 0; i < a.length; i += 2) {
        const X = f.mx + a[i] * f.s, Y = f.my + a[i + 1] * f.s;
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.closePath();
    }
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
  if (e < 1) drawWater(g, water[cur.slug], f.mx, f.my, f.s, k, 1 - e, null);
  paths = paths || buildPaths(f, e, L, k);
  for (let t = 0; t < paths.length; t++) {
    const a = active && !active.has(t) ? (CFG.dimAlpha ?? 0.12) : 1;
    g.fillStyle = classColor(t);
    if (e < 1 && paths.hidden) { g.globalAlpha = a * (1 - e); g.fill(paths.hidden[t], "evenodd"); }
    g.globalAlpha = a;
    g.fill(paths[t], "evenodd");
  }
  g.globalAlpha = 1;
  if (L && L.grp && e > 0) {
    g.globalAlpha = e;
    g.fillStyle = th.sub || "#c9ccd3";
    const fs = scaleOut && scaleOut.labelPx ? scaleOut.labelPx : 12;
    g.font = `500 ${fs / k}px ${th.font || "sans-serif"}`;
    for (const lab of L.labels) g.fillText(groupLabel(L, lab), f.lx, f.ly + lab[1] * f.s - 4 / k);
    g.globalAlpha = 1;
  }
  g.restore();
  return { f, paths };
}

function niceScale(pxPerM, minPx) {
  const ftSteps = [10, 20, 50, 100, 200, 500, 1000, 2000];
  for (const v of ftSteps) if ((v / FT) * pxPerM >= minPx) return { px: (v / FT) * pxPerM, label: `${fmt(v)} ft` };
  for (const v of [0.5, 1, 2, 5, 10, 20, 50]) {
    const m = v * 1609.344;
    if (m * pxPerM >= minPx) return { px: m * pxPerM, label: `${v} mi` };
  }
  return { px: 50 * 1609.344 * pxPerM, label: "50 mi" };
}

function draw() {
  if (!cur || view === "stats") return;
  const w = stage.clientWidth, h = stage.clientHeight, r = dpr();
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.fillStyle = (CFG.theme || {}).bg || "#0f1115";
  ctx.fillRect(0, 0, w, h);
  const e = ease(anim), box = screenBox();
  const L = e > 0 ? layout : null;

  // Cache the paths for still frames; rebuild when the zoom changes a lot.
  let paths = null;
  const still = anim === 0 || anim === 1;
  const key = `${cur.slug}|${anim}|${w}x${h}|${L ? L.W.toFixed(2) : ""}`;
  if (still && pathCache && pathCache.key === key && pathCache.k / zoom.k < 2 && zoom.k / pathCache.k < 2) {
    paths = pathCache.paths;
  }
  const out = renderScene(ctx, box, e, L, zoom.k, zoom.x, zoom.y, null, paths);
  if (still && !paths) pathCache = { key, k: zoom.k, paths: out.paths };

  if (miniSel >= 0 && still && view === "sorted" && L && cur.B[miniSel].vis) {
    outlineBuilding(cur.B[miniSel], out.f, e, L, (CFG.theme || {}).selected || "#ffffff", 2.5);
  }
  if (selected >= 0 && still && view === "map") {
    outlineBuilding(cur.B[selected], out.f, e, L, (CFG.theme || {}).selected || "#ffffff", 2.5);
  }
  if (hover >= 0 && still) {
    const b = cur.B[hover];
    const [ox, oy, th] = place(b, out.f, e, L);
    ctx.save();
    ctx.translate(zoom.x, zoom.y); ctx.scale(zoom.k, zoom.k);
    const p = new Path2D(), c = Math.cos(th), sn = Math.sin(th), s = out.f.s;
    for (const a of b.rs) {
      for (let i = 0; i < a.length; i += 2) {
        const X = ox + (c * a[i] - sn * a[i + 1]) * s, Y = oy + (sn * a[i] + c * a[i + 1]) * s;
        i ? p.lineTo(X, Y) : p.moveTo(X, Y);
      }
      p.closePath();
    }
    ctx.strokeStyle = (CFG.theme || {}).hover || "#fff";
    ctx.lineWidth = 1.5 / zoom.k;
    ctx.stroke(p);
    ctx.restore();
  }

  const sc = niceScale(out.f.s * zoom.k, 60);
  $("scale").querySelector("i").style.width = `${sc.px}px`;
  $("scale").querySelector("span").textContent = sc.label;
}

function resize() {
  const r = dpr();
  cv.width = Math.round(stage.clientWidth * r);
  cv.height = Math.round(stage.clientHeight * r);
  if (cur) layout = computeLayout(screenBox(), 12);
  pathCache = null;
  draw();
}
new ResizeObserver(() => { if (view !== "stats") resize(); }).observe(stage);

// ── views ───────────────────────────────────────────────────────
let animReq = 0;
function animateTo(target) {
  cancelAnimationFrame(animReq);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { anim = target; draw(); return; }
  const from = anim, t0 = performance.now(), dur = CFG.animationMs || 1600;
  const step = (now) => {
    const d = Math.min(1, (now - t0) / dur);
    anim = from + (target - from) * d;
    draw();
    if (d < 1) animReq = requestAnimationFrame(step);
  };
  animReq = requestAnimationFrame(step);
}

function setView(v, instant) {
  const prev = view;
  view = v;
  if (v !== "map" && selected >= 0) closeSelection();
  if (v === "sorted") requestAnimationFrame(drawMini);
  document.body.classList.toggle("v-sorted", v === "sorted");
  document.body.classList.toggle("v-stats", v === "stats");
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === v)));
  $("tip").style.display = "none";
  writeHash();
  if (!cur) return;
  if (v === "stats") { renderStats(); return; }
  zoom = { k: 1, x: 0, y: 0 };
  resize();
  const target = v === "sorted" ? 1 : 0;
  if (instant || prev === "stats") { anim = target; draw(); }
  else animateTo(target);
}

document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setView(b.dataset.v)));
$("optGroup").onchange = (e) => { opts.group = e.target.checked; relayout(); };
$("optAlign").onchange = (e) => { opts.align = e.target.checked; relayout(); };
$("optShow").onchange = (e) => { opts.show = e.target.value; $("nWrap").hidden = opts.show === "all"; relayout(); };
let nTimer = 0;
$("optN").oninput = (e) => {
  clearTimeout(nTimer);
  nTimer = setTimeout(() => {
    const v = Math.round(Number(e.target.value));
    if (!Number.isFinite(v) || v < 1) return;
    opts.n = v;
    if (opts.show !== "all") relayout();
  }, 350);
};
$("resetView").onclick = () => { zoom = { k: 1, x: 0, y: 0 }; draw(); };
function relayout() { layout = computeLayout(screenBox(), 12); pathCache = null; draw(); }

// ── zoom + pan + hover ──────────────────────────────────────────
cv.addEventListener("wheel", (e) => {
  if (!cur) return;
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const k2 = Math.min(400, Math.max(1, zoom.k * Math.exp(-e.deltaY * 0.0015)));
  zoom.x = mx - (mx - zoom.x) * (k2 / zoom.k);
  zoom.y = my - (my - zoom.y) * (k2 / zoom.k);
  zoom.k = k2;
  if (zoom.k === 1) zoom.x = zoom.y = 0;
  draw();
}, { passive: false });

let drag = null;
cv.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, moved: false };
  cv.setPointerCapture(e.pointerId);
  cv.classList.add("dragging");
});
cv.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { zoom.x = drag.zx + dx; zoom.y = drag.zy + dy; $("tip").style.display = "none"; draw(); }
    return;
  }
  hoverAt(e);
});
const endDrag = () => { drag = null; cv.classList.remove("dragging"); };
cv.addEventListener("pointerup", (e) => {
  const click = drag && !drag.moved;
  endDrag();
  if (!click) return;
  const r = cv.getBoundingClientRect();
  if (view === "sorted") { setMini(pickAt(e.clientX - r.left, e.clientY - r.top)); return; }
  if (view !== "map") return;   // selecting and ranks are a map-view tool
  const i = pickAt(e.clientX - r.left, e.clientY - r.top);
  if (i >= 0) selectBuilding(i); else closeSelection();
});
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { if (!drag) { hover = -1; $("tip").style.display = "none"; draw(); } });

// Building under a canvas point (smallest wins when outlines overlap), or -1
function pickAt(sx, sy) {
  if (!cur || !(anim === 0 || anim === 1)) return -1;
  const px = (sx - zoom.x) / zoom.k, py = (sy - zoom.y) / zoom.k;
  const e = anim, L = e ? layout : null, f = fit(e, screenBox(), L), s = f.s;
  const slop = 3 / zoom.k;
  let best = -1, bestA = Infinity;
  for (let i = 0; i < cur.B.length; i++) {
    const b = cur.B[i];
    if (active && !active.has(b.t)) continue;
    if (e && !b.vis) continue;
    let x0, y0, x1, y1;
    if (e) { x0 = f.lx + (b.sx - b.bw / 2) * s; y0 = f.ly + (b.sy - b.bh / 2) * s; x1 = x0 + b.bw * s; y1 = y0 + b.bh * s; }
    else { x0 = f.mx + (b.cx + b.x0) * s; y0 = f.my + (b.cy + b.y0) * s; x1 = f.mx + (b.cx + b.x1) * s; y1 = f.my + (b.cy + b.y1) * s; }
    if (px >= x0 - slop && px <= x1 + slop && py >= y0 - slop && py <= y1 + slop && b.area < bestA) { best = i; bestA = b.area; }
  }
  return best;
}

let hoverReq = 0;
function hoverAt(ev) {
  if (!cur || !(anim === 0 || anim === 1)) return;
  cancelAnimationFrame(hoverReq);
  hoverReq = requestAnimationFrame(() => {
    const r = cv.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const best = pickAt(sx, sy);
    if (best !== hover) { hover = best; draw(); }
    const tip = $("tip");
    if (best < 0) { tip.style.display = "none"; return; }
    const b = cur.B[best];
    tip.innerHTML = `<strong>${esc(IDX.prims[b.prim])}</strong><br>${esc(className(b.t))} · ${fmt(b.area * SQFT)} ft²`;
    tip.style.display = "block";
    tip.style.left = `${Math.min(sx + 12, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.min(sy + 12, r.height - tip.offsetHeight - 4)}px`;
  });
}

// ── selection + ranks ──────────────────────────────────────────
function outlineBuilding(b, f, e, L, color, width) {
  const [ox, oy, th] = place(b, f, e, L);
  ctx.save();
  ctx.translate(zoom.x, zoom.y); ctx.scale(zoom.k, zoom.k);
  const p = new Path2D(), c = Math.cos(th), sn = Math.sin(th), s = f.s;
  for (const a of b.rs) {
    for (let i = 0; i < a.length; i += 2) {
      const X = ox + (c * a[i] - sn * a[i + 1]) * s, Y = oy + (sn * a[i] + c * a[i + 1]) * s;
      i ? p.lineTo(X, Y) : p.moveTo(X, Y);
    }
    p.closePath();
  }
  // a ring around tiny buildings so the selection is visible at county scale
  if (b.rad * s * zoom.k < 6) p.arc(ox, oy, 8 / zoom.k, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width / zoom.k;
  ctx.stroke(p);
  ctx.restore();
}

async function loadRanks() {
  if (RANKS) return RANKS;
  const r = await fetch("data/ranks.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(r.status);
  const d = await r.json();
  const decode = (deltas) => {
    const a = new Int32Array(deltas.length);
    let v = 0;
    for (let i = 0; i < deltas.length; i++) { v = i ? v - deltas[i] : deltas[i]; a[i] = v; }
    return a;
  };
  RANKS = d.classes.map(decode);
  return RANKS;
}

// How many values in a largest-first array are bigger than v
function countLarger(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] > v) lo = m + 1; else hi = m; }
  return lo;
}

// 1 -> "1st", 22 -> "22nd", 113 -> "113th"
function ordinal(n) {
  const v = n % 100, suf = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
  return fmt(n) + suf;
}

// One sentence from a config template; {rank}, {total} (bold), {class} and {county}.
function sentence(tpl, name, vars) {
  if (!tpl) return `<p class="sel-line ph">[${name}]</p>`;
  const html = esc(tpl)
    .replace("{rank}", `<b>${ordinal(vars.rank)}</b>`)
    .replace("{total}", `<b>${fmt(vars.total)}</b>`)
    .replace("{class}", esc(vars.cls || ""))
    .replace("{county}", esc(vars.county || ""));
  return `<p class="sel-line">${html}</p>`;
}

async function selectBuilding(i) {
  selected = i;
  draw();
  const b = cur.B[i], S = T.selection || {};
  const a10 = Math.round(b.area * 10);
  const cls = className(b.t);
  // County ranks: 1 + number of buildings with a bigger footprint (equal sizes share a rank)
  let cAll = 0, cCls = 0, nCls = 0;
  for (const x of cur.B) {
    const bigger = Math.round(x.area * 10) > a10;
    if (bigger) cAll++;
    if (x.t === b.t) { nCls++; if (bigger) cCls++; }
  }
  const heading = (tpl, name) => tpl
    ? `<h4 class="sel-sub">${esc(tpl.replace("{county}", cur.name))}</h4>`
    : `<h4 class="sel-sub ph">[${name}]</h4>`;
  const panel = $("sel");
  panel.innerHTML = `
    <div class="sel-head">
      <div><strong>${esc(IDX.prims[b.prim])}</strong> <span class="sel-class"><i style="background:${esc(classColor(b.t))}"></i>${esc(cls)}</span></div>
      <button type="button" class="sel-close" aria-label="${esc(S.close || "Close")}">&times;</button>
    </div>
    <p class="sel-size">${fmt(b.area * SQFT)} ft²</p>
    ${heading(S.countyHeading, "selection.countyHeading")}
    ${sentence(S.rankAll, "selection.rankAll", { rank: cAll + 1, total: cur.B.length, cls, county: cur.name })}
    ${sentence(S.rankClass, "selection.rankClass", { rank: cCls + 1, total: nCls, cls, county: cur.name })}
    ${heading(S.crcHeading, "selection.crcHeading")}
    <div class="sel-crc">…</div>`;
  panel.hidden = false;
  panel.querySelector(".sel-close").onclick = closeSelection;
  try {
    const R = await loadRanks();
    if (selected !== i) return;
    let all = 0, total = 0;
    for (const arr of R) { all += countLarger(arr, a10); total += arr.length; }
    const clsArr = R[b.t] || new Int32Array(0);
    panel.querySelector(".sel-crc").outerHTML =
      sentence(S.rankAll, "selection.rankAll", { rank: all + 1, total, cls, county: cur.name }) +
      sentence(S.rankClass, "selection.rankClass", { rank: countLarger(clsArr, a10) + 1, total: clsArr.length, cls, county: cur.name });
  } catch (err) {
    const el = panel.querySelector(".sel-crc");
    if (el) el.textContent = "data/ranks.json could not be loaded.";
  }
}

function closeSelection() {
  selected = -1;
  const panel = $("sel");
  if (panel) panel.hidden = true;
  if (cur) draw();
}
addEventListener("keydown", (e) => { if (e.key === "Escape" && selected >= 0) closeSelection(); });

// ── water + mini-map ───────────────────────────────────────────
async function loadWater(slug, H) {
  try {
    const r = await fetch(`data/water/${slug}.json`, { cache: "no-cache" });
    if (!r.ok) return null;
    const d = await r.json();
    // metres from the county corner, y up -> y down like the buildings; keep a bbox per shape
    const conv = (flatList) => {
      const a = new Float32Array(flatList.length);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < flatList.length; i += 2) {
        const x = flatList[i], y = H - flatList[i + 1];
        a[i] = x; a[i + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { a, x0, y0, x1, y1 };
    };
    return {
      areas: (d.areas || []).map((poly) => poly.map(conv)),
      rivers: (d.rivers || []).map(conv)
    };
  } catch (e) {
    return null;
  }
}

// Draw water in map coordinates: screen = origin + metres * s. `win` limits drawing to a box.
function drawWater(g, w, ox, oy, s, k, alpha, win) {
  if (!w || alpha <= 0) return;
  const th = CFG.theme || {};
  const inWin = (r) => !win || (r.x1 >= win[0] && r.x0 <= win[2] && r.y1 >= win[1] && r.y0 <= win[3]);
  const p = new Path2D();
  for (const poly of w.areas) {
    if (!inWin(poly[0])) continue;
    for (const ring of poly) {
      const a = ring.a;
      for (let i = 0; i < a.length; i += 2) {
        const X = ox + a[i] * s, Y = oy + a[i + 1] * s;
        i ? p.lineTo(X, Y) : p.moveTo(X, Y);
      }
    }
  }
  g.globalAlpha = alpha;
  g.fillStyle = th.water || "#14273b";
  g.fill(p, "evenodd");
  const q = new Path2D();
  for (const ln of w.rivers) {
    if (!inWin(ln)) continue;
    const a = ln.a;
    for (let i = 0; i < a.length; i += 2) {
      const X = ox + a[i] * s, Y = oy + a[i + 1] * s;
      i ? q.lineTo(X, Y) : q.moveTo(X, Y);
    }
  }
  g.strokeStyle = th.river || "#2b4f73";
  g.lineWidth = 1.2 / k;
  g.stroke(q);
  g.globalAlpha = 1;
}

// Mini-map: a close-up of the clicked building's real location, with its neighbours
function setMini(i) {
  miniSel = i;
  if (cur) draw();
  drawMini();
}

function drawMini() {
  const c = $("miniCv"), cap = $("miniCap");
  if (!c || !cur) return;
  const r = dpr(), w = c.clientWidth || 340, h = c.clientHeight || 220;
  c.width = Math.round(w * r); c.height = Math.round(h * r);
  const g = c.getContext("2d");
  g.setTransform(r, 0, 0, r, 0, 0);
  const th = CFG.theme || {};
  g.fillStyle = th.bg || "#0f1115";
  g.fillRect(0, 0, w, h);
  const M = T.minimap || {};
  if (miniSel < 0) {
    put(cap, M.hint, "minimap.hint");
    return;
  }
  const b = cur.B[miniSel];
  // window: the building plus a few blocks around it
  const half = Math.max(220, b.rad * 2.2);
  const s = Math.min(w, h) / (2 * half);
  const ox = w / 2 - b.cx * s, oy = h / 2 - b.cy * s;
  const win = [b.cx - w / (2 * s), b.cy - h / (2 * s), b.cx + w / (2 * s), b.cy + h / (2 * s)];
  drawWater(g, water[cur.slug], ox, oy, s, 1, 1, win);
  const paths = IDX.classes.map(() => new Path2D());
  for (const x of cur.B) {
    if (x.cx + x.x1 < win[0] || x.cx + x.x0 > win[2] || x.cy + x.y1 < win[1] || x.cy + x.y0 > win[3]) continue;
    const p = paths[x.t];
    for (const a of x.rs) {
      for (let j = 0; j < a.length; j += 2) {
        const X = ox + (x.cx + a[j]) * s, Y = oy + (x.cy + a[j + 1]) * s;
        j ? p.lineTo(X, Y) : p.moveTo(X, Y);
      }
    }
  }
  paths.forEach((p, t) => { g.globalAlpha = 0.85; g.fillStyle = classColor(t); g.fill(p, "evenodd"); });
  g.globalAlpha = 1;
  const sel = new Path2D();
  for (const a of b.rs) {
    for (let j = 0; j < a.length; j += 2) {
      const X = ox + (b.cx + a[j]) * s, Y = oy + (b.cy + a[j + 1]) * s;
      j ? sel.lineTo(X, Y) : sel.moveTo(X, Y);
    }
    sel.closePath();
  }
  g.fillStyle = classColor(b.t);
  g.fill(sel, "evenodd");
  g.strokeStyle = th.selected || "#00e5ff";
  g.lineWidth = 2.5;
  g.stroke(sel);
  if (b.rad * s < 10) { g.beginPath(); g.arc(w / 2, h / 2, 12, 0, Math.PI * 2); g.stroke(); }
  // scale bar
  const sc = niceScale(s, 50);
  g.strokeStyle = g.fillStyle = th.muted || "#8a8f99";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, h - 12); g.lineTo(10 + sc.px, h - 12); g.stroke();
  g.font = `11px ${th.font || "sans-serif"}`;
  g.fillText(sc.label, 10, h - 17);
  cap.classList.remove("ph");
  cap.innerHTML = `<strong>${esc(IDX.prims[b.prim])}</strong><i style="background:${esc(classColor(b.t))}"></i>${esc(className(b.t))} · ${fmt(b.area * SQFT)} ft²`;
}

// ── stats tab ───────────────────────────────────────────────────
function bar(parts, total, colors) {
  return `<div class="bar">${parts.map((v, i) => {
    const p = total ? (v / total) * 100 : 0;
    // dark text on light segments, light text on dark ones
    const n = parseInt(String(colors[i]).slice(1), 16), lumi = ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
    const ink = lumi > 0.55 ? "#0f1115" : "#f0f0f0";
    return p > 0 ? `<div style="width:${p}%;background:${esc(colors[i])};color:${ink}" title="${p.toFixed(1)}%">${p >= 7 ? Math.round(p) + "%" : ""}</div>` : "";
  }).join("")}</div>`;
}
function heading(value, name) {
  return value ? `<h3>${esc(value)}</h3>` : `<h3 class="ph">[${name}]</h3>`;
}
function renderStats() {
  const s = summary(), S = T.stats || {};
  const cc = IDX.classes.map((c, i) => classColor(i));
  const sz = CFG.sizeColors || [];
  const rowB = esc(S.rowBuildings || "[rowBuildings]"), rowF = esc(S.rowFootprint || "[rowFootprint]");
  const cols = S.largestCols || ["", "", ""];
  let html = `
    <div class="block">${heading(S.byClass, "stats.byClass")}
      <div class="barrow"><span>${rowB}</span>${bar(s.tc, s.count, cc)}</div>
      <div class="barrow"><span>${rowF}</span>${bar(s.ta, s.foot, cc)}</div>
    </div>
    <div class="block">${heading(S.bySize, "stats.bySize")}
      <div class="barrow"><span>${rowB}</span>${bar(s.sc, s.count, sz)}</div>
      <div class="barrow"><span>${rowF}</span>${bar(s.sa, s.foot, sz)}</div>
      <div class="legend">${(CFG.sizeLabels || []).map((l, i) => `<span style="display:inline-flex;gap:6px;align-items:center;color:var(--sub)"><i style="background:${esc(sz[i])}"></i>${esc(l)}</span>`).join("")}</div>
    </div>
    <div class="block">${heading(S.concentration, "stats.concentration")}
      <div class="statgrid ${S.concentrationText ? "" : "ph"}">${S.concentrationText ? fillTokens(S.concentrationText, s) : "[stats.concentrationText]"}</div>
    </div>
    <div class="block">${heading(S.largest, "stats.largest")}
      <table class="toplist"><thead><tr>${cols.map((c, i) => `<th${i === 2 ? ' style="text-align:right"' : ""}>${esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${s.top.map(([prim, t, area]) => `<tr><td>${esc(IDX.prims[prim])}</td><td><i style="background:${esc(classColor(t))}"></i>${esc(className(t))}</td><td class="num">${fmt(area * SQFT)}</td></tr>`).join("")}
      </tbody></table>
    </div>
    <div class="block small">${heading(S.allCounties, "stats.allCounties")}
      ${IDX.counties.map((c) => `<div class="barrow${c.slug === cur.slug ? " on" : ""}" data-slug="${esc(c.slug)}" tabindex="0" role="button"><span>${esc(c.name)}</span>${bar(c.ta, c.foot, cc)}</div>`).join("")}
    </div>`;
  const el = $("stats");
  el.innerHTML = html;
  el.querySelectorAll(".small .barrow").forEach((r) => {
    r.onclick = () => load(r.dataset.slug);
    r.onkeydown = (e) => { if (e.key === "Enter") load(r.dataset.slug); };
  });
}

// ── poster PNG ──────────────────────────────────────────────────
$("savePoster").onclick = async () => {
  if (!cur || view === "stats") return;
  const btn = $("savePoster");
  btn.disabled = true;
  await new Promise((r) => setTimeout(r, 30));
  try {
    const { width: W, height: H } = CFG.posterSize || { width: 7200, height: 10800 };
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const th = CFG.theme || {}, font = th.font || "sans-serif", P = T.poster || {};
    const u = W / 1080;                      // type scale relative to a 1080 px wide layout
    g.fillStyle = th.bg || "#0f1115";
    g.fillRect(0, 0, W, H);

    const box = { x: 60 * u, y: 220 * u, w: W - 120 * u, h: H - 220 * u - 170 * u, pad: 0 };
    const e = view === "sorted" ? 1 : 0;
    const labelPx = 15 * u;
    const L = e ? computeLayout(box, labelPx) : null;
    const out = renderScene(g, box, e, L, 1, 0, 0, { labelPx }, null);

    g.fillStyle = th.text || "#fff";
    g.textBaseline = "alphabetic";
    g.font = `700 ${40 * u}px ${font}`;
    g.fillText(P.title || T.title || "", 60 * u, 90 * u);
    g.fillStyle = th.sub || "#ccc";
    g.font = `400 ${24 * u}px ${font}`;
    g.fillText((P.subtitle || "").replace("{county}", cur.name), 60 * u, 132 * u);

    // legend
    let x = 60 * u, y = H - 120 * u;
    g.font = `400 ${15 * u}px ${font}`;
    const present = IDX.classes.map((_, i) => i).filter((i) => summary().tc[i] && (!active || active.has(i)));
    for (const t of present) {
      const name = className(t), wName = g.measureText(name).width;
      if (x + 18 * u + wName > W - 240 * u) { x = 60 * u; y += 26 * u; }
      g.fillStyle = classColor(t);
      g.fillRect(x, y - 12 * u, 12 * u, 12 * u);
      g.fillStyle = th.sub || "#ccc";
      g.fillText(name, x + 18 * u, y);
      x += 18 * u + wName + 22 * u;
    }
    // scale bar
    const sc = niceScale(out.f.s, 100 * u);
    g.strokeStyle = g.fillStyle = th.muted || "#888";
    g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(W - 60 * u - sc.px, H - 126 * u); g.lineTo(W - 60 * u, H - 126 * u); g.stroke();
    g.textAlign = "right";
    g.fillText(sc.label, W - 60 * u, H - 134 * u);
    g.textAlign = "left";
    g.font = `400 ${14 * u}px ${font}`;
    g.fillText(P.credits || "", 60 * u, H - 50 * u);

    // restore the on-screen layout (the poster pass overwrote slot positions)
    layout = computeLayout(screenBox(), 12);
    pathCache = null;
    draw();

    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("toBlob failed");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cur.slug}-${view}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    console.error(err);
    alert("The poster could not be created. Try a smaller posterSize in config.js.");
  } finally {
    btn.disabled = false;
  }
};

addEventListener("hashchange", () => {
  const h = readHash();
  if (!cur) return;
  const v = ["map", "sorted", "stats"].includes(h.v) ? h.v : view;
  if (h.c && h.c !== cur.slug) { view = v; load(h.c); }   // load() applies the view
  else if (v !== view) setView(v);
});

start();
