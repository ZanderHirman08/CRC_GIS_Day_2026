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
let active = null;         // Set of class indices shown at full strength (null = all)
let zoom = { k: 1, x: 0, y: 0 };
let pathCache = null;
const opts = {
  group: CFG.defaultGroup !== false,
  align: CFG.defaultAlign !== false
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
  put($("intro"), T.intro, "intro");
  put($("footer"), T.footer, "footer", true);
  const back = T.backLink || {};
  $("backLink").href = back.url || "#";
  put($("backLink"), back.label ? `← ${back.label}` : "", "backLink.label");

  const tabs = T.tabs || {}, c = T.controls || {};
  put($("tabMap"), tabs.map, "tabs.map");
  put($("tabSorted"), tabs.sorted, "tabs.sorted");
  put($("tabStats"), tabs.stats, "tabs.stats");
  put($("lblGroup"), c.group, "controls.group");
  put($("lblAlign"), c.align, "controls.align");
  put($("resetView"), c.reset, "controls.reset");
  put($("savePoster"), c.poster, "controls.poster");

  $("optGroup").checked = opts.group;
  $("optAlign").checked = opts.align;
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
    const r = await fetch("data/index.json");
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
      const r = await fetch(`data/counties/${slug}.json`);
      if (!r.ok) throw new Error(r.status);
      cache[slug] = prep(await r.json());
    }
  } catch (e) {
    message(`data/counties/${slug}.json could not be loaded.`);
    return;
  }
  message("");
  cur = cache[slug];
  hover = -1;
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
  const order = B.map((b, i) => i);
  order.sort((i, j) => (opts.group ? B[i].t - B[j].t : 0) || B[j].area - B[i].area);

  const gap = Math.max(0.5, Math.sqrt(cur.B.reduce((s, b) => s + b.area, 0) / cur.B.length) * 0.08);
  let tot = 0;
  for (const b of B) tot += (b.bw + gap) * (b.bh + gap);
  const W = Math.sqrt(tot * 1.12 * aspect) * widthFactor;
  let x = 0, y = 0, rowH = 0, lastT = -1;
  const labels = [];
  for (const i of order) {
    const b = B[i];
    if (opts.group && b.t !== lastT) {
      if (x > 0) { y += rowH + gap; x = 0; rowH = 0; }
      y += labH + gap * 2; labels.push([b.t, y]); lastT = b.t;
    }
    if (x > 0 && x + b.bw > W) { x = 0; y += rowH + gap; rowH = 0; }
    b.sx = x + b.bw / 2; b.sy = y + b.bh / 2; x += b.bw + gap;
    if (b.bh > rowH) rowH = b.bh;
  }
  return { W: Math.max(W, x), H: y + rowH, labels, grp: opts.group, aspect };
}

// Lay out for a drawing box; group labels need a second pass at the final scale.
function computeLayout(box, labelPx) {
  // Repack a few times so the block of rows matches the drawing box's shape.
  const aspect = (box.w - 2 * box.pad) / (box.h - 2 * box.pad);
  let factor = 1, L = null, labH = 0;
  for (let i = 0; i < 6; i++) {
    L = layoutPass(labH, aspect, factor);
    const s = Math.min((box.w - 2 * box.pad) / L.W, (box.h - 2 * box.pad) / L.H);
    if (opts.group) labH = labelPx / s;
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

// One Path2D per class. Footprints under ~1 px are drawn as squares of equal area.
function buildPaths(f, e, L, k) {
  const paths = IDX.classes.map(() => new Path2D());
  const tiny = 0.9 / k;
  for (const b of cur.B) {
    const [ox, oy, th] = place(b, f, e, L);
    const p = paths[b.t];
    if (b.rad * f.s < tiny) {
      const side = Math.sqrt(b.area) * f.s;
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
  paths = paths || buildPaths(f, e, L, k);
  for (let t = 0; t < paths.length; t++) {
    g.globalAlpha = active && !active.has(t) ? (CFG.dimAlpha ?? 0.12) : 1;
    g.fillStyle = classColor(t);
    g.fill(paths[t], "evenodd");
  }
  g.globalAlpha = 1;
  if (L && L.grp && e > 0) {
    g.globalAlpha = e;
    g.fillStyle = th.sub || "#c9ccd3";
    const fs = scaleOut && scaleOut.labelPx ? scaleOut.labelPx : 12;
    g.font = `500 ${fs / k}px ${th.font || "sans-serif"}`;
    for (const [t, y] of L.labels) g.fillText(className(t), f.lx, f.ly + y * f.s - 4 / k);
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
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { if (!drag) { hover = -1; $("tip").style.display = "none"; draw(); } });

let hoverReq = 0;
function hoverAt(ev) {
  if (!cur || !(anim === 0 || anim === 1)) return;
  cancelAnimationFrame(hoverReq);
  hoverReq = requestAnimationFrame(() => {
    const r = cv.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const px = (sx - zoom.x) / zoom.k, py = (sy - zoom.y) / zoom.k;
    const e = anim, L = e ? layout : null, f = fit(e, screenBox(), L), s = f.s;
    const slop = 3 / zoom.k;
    let best = -1, bestA = Infinity;
    for (let i = 0; i < cur.B.length; i++) {
      const b = cur.B[i];
      if (active && !active.has(b.t)) continue;
      let x0, y0, x1, y1;
      if (e) { x0 = f.lx + (b.sx - b.bw / 2) * s; y0 = f.ly + (b.sy - b.bh / 2) * s; x1 = x0 + b.bw * s; y1 = y0 + b.bh * s; }
      else { x0 = f.mx + (b.cx + b.x0) * s; y0 = f.my + (b.cy + b.y0) * s; x1 = f.mx + (b.cx + b.x1) * s; y1 = f.my + (b.cy + b.y1) * s; }
      if (px >= x0 - slop && px <= x1 + slop && py >= y0 - slop && py <= y1 + slop && b.area < bestA) { best = i; bestA = b.area; }
    }
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

// ── stats tab ───────────────────────────────────────────────────
function bar(parts, total, colors) {
  return `<div class="bar">${parts.map((v, i) => {
    const p = total ? (v / total) * 100 : 0;
    return p > 0 ? `<div style="width:${p}%;background:${esc(colors[i])}" title="${p.toFixed(1)}%">${p >= 7 ? Math.round(p) + "%" : ""}</div>` : "";
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
  if (h.c && h.c !== cur.slug) load(h.c);
  else if (h.v && h.v !== view) setView(h.v);
});

start();
