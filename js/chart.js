"use strict";
/* Interactive line chart on a canvas: a port of the desktop program's LineChart.
   Hover a line (or a name in the key) to highlight it and fade the others; a box shows the value at the point
   you are on.  series = [{ label, color, pts: [[x, y], ...] }] */

function niceStep(span, target = 6, integer = false) {
  if (span <= 0) return 1;
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const cands = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = (cands.map((m) => m * mag).find((v) => v >= raw - 1e-12)) ?? 10 * mag;
  return integer ? Math.max(1, pyRound(step)) : step;
}

function niceTicks(lo, hi, step, anchor = null) {
  const base = anchor !== null ? anchor : 0;
  const out = [];
  for (let n = Math.ceil((lo - base) / step - 1e-9); base + n * step <= hi + 1e-9 && out.length <= 200; n++) out.push(base + n * step);
  return out;
}

class LineChart {
  constructor(canvas) {
    this.cv = canvas;
    canvas._chart = this;                       // lets tests and the console reach the chart
    this.series = []; this.xlabels = {};
    this.opt = { invert: false, clip: false, integer: false, zero: false, unit: 1, yfmt: (v) => fmtPts(v) };
    this.hover = null; this.hoverPt = null; this.geo = null;
    this.legendRows = [];
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onMove(e));
    canvas.addEventListener("pointerleave", () => this.setHover(null, null));
    canvas.addEventListener("click", () => {                 // a point that came from a session: open that session
      const L = this.opt.links, m = Array.isArray(L) ? L[this.hover] : L;        // one map per line, or one for all
      const sid = m && this.hover !== null && this.hoverPt ? m[this.hoverPt[0]] : null;
      if (sid && window.openSession) window.openSession(sid);
    });
    canvas.style.touchAction = "pan-y";
    if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(canvas);
    this.draw();
  }

  setData(series, opt = {}) {
    this.series = series;
    this.xlabels = opt.xlabels || {};
    this.opt = Object.assign({ invert: false, clip: false, integer: false, zero: false, unit: 1, yfmt: (v) => fmtPts(v) }, opt);
    this.opt.unit = this.opt.unit || 1;
    this.hover = null; this.hoverPt = null;
    this.draw();
  }

  yAxis(ymin, ymax, height) {
    const o = this.opt, u = o.unit;
    const target = Math.max(3, Math.floor(height / 50));
    if (o.invert) {                                         // places: P1 at the top, every tick a whole place
      const lo = Math.floor(ymin), hi = Math.ceil(ymax);
      const step = niceStep(hi - lo, Math.max(3, Math.floor(height / 24)), true);
      return [lo - 0.5, hi + 0.5, niceTicks(lo, hi, step, lo)];
    }
    if (o.zero && ymin >= 0) ymin = 0;
    const span = Math.max(ymax - ymin, o.integer ? u : 1e-9);
    const step = niceStep(span / u, target, o.integer) * u;
    let lo, hi;
    if (o.zero || o.integer) {
      lo = Math.floor(ymin / step + 1e-9) * step;
      hi = Math.ceil(ymax / step - 1e-9) * step;
      if (hi <= lo) hi = lo + step;
      if (ymin < 0 && step > 5 * u) lo = Math.floor(ymin / (5 * u) + 1e-9) * 5 * u;       // a little below zero (gaps): drop in 5 s sections, not a whole big step
    } else {
      const pad = span * 0.06;
      lo = ymin - pad; hi = ymax + pad;
    }
    const ticks = niceTicks(lo, hi, step);
    if (lo < 0 && (!ticks.length || ticks[0] > lo + 1e-9)) ticks.unshift(lo);
    return [lo, hi, ticks];
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = { panel: cssVar("--panel"), panel2: cssVar("--panel2"), border: cssVar("--border"), text: cssVar("--text"), dim: cssVar("--dim"), hi: cssVar("--hi"), tip: cssVar("--tip-bg") };
    g.fillStyle = C.panel; g.fillRect(0, 0, W, H);
    const o = this.opt;
    const pts = this.series.flatMap((s) => s.pts);
    this.legendRows = []; this.geo = null;
    if (!pts.length) {
      g.fillStyle = C.dim; g.font = "13px 'Segoe UI', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("No data available", W / 2, H / 2); return;
    }
    const narrow = W < 640;
    const legendW = narrow ? 112 : 170;
    const l = narrow ? 46 : 62, t = 16, r = legendW + 16, b = 38;
    const plot = { left: l, top: t, w: Math.max(50, W - l - r), h: Math.max(50, H - t - b) };
    plot.right = plot.left + plot.w; plot.bottom = plot.top + plot.h;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const xmin = Math.min(...xs); let xmax = Math.max(...xs);
    if (xmax === xmin) xmax = xmin + 1;
    let ymin = Math.min(...ys), ymax = Math.max(...ys);
    if (o.clip) {
      const sy = [...ys].sort((a, b2) => a - b2), med = sy[Math.floor(sy.length / 2)];
      ymax = Math.min(ymax, med * 1.08); ymin = Math.min(ymin, ymax);
    }
    if (o.ycap) { ymax = Math.min(ymax, o.ycap); ymin = Math.min(ymin, ymax); }      // the axis stops here
    let [ylo, yhi, yticks] = this.yAxis(ymin, ymax, plot.h);
    if (o.ycap && yhi > o.ycap) { yhi = o.ycap; yticks = yticks.filter((v) => v <= yhi + 1e-9); }
    const mx = (x) => plot.left + ((x - xmin) / (xmax - xmin)) * plot.w;
    const my = (y) => {
      y = Math.max(ylo, Math.min(yhi, y));
      const f = (y - ylo) / (yhi - ylo);
      return plot.top + (o.invert ? f : 1 - f) * plot.h;
    };
    g.font = "11px 'Segoe UI', system-ui, sans-serif";
    for (let v of yticks) {
      if (o.integer || o.invert) v = o.unit !== 1 ? pyRound(v / o.unit) * o.unit : pyRound(v);
      const yy = my(v);
      g.strokeStyle = C.border; g.lineWidth = 1; g.beginPath(); g.moveTo(plot.left, yy); g.lineTo(plot.right, yy); g.stroke();
      g.fillStyle = C.dim; g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(o.yfmt(v), l - 8, yy);
    }
    const xticks = [...new Set(xs)].sort((a, b2) => a - b2);
    const xstep = Math.max(1, Math.floor(xticks.length / (narrow ? 8 : 14)));
    xticks.forEach((xv, i) => {
      if (i % xstep) return;
      const xx = mx(xv);
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(xx, plot.top); g.lineTo(xx, plot.bottom); g.stroke();
      const lab = this.xlabels[xv] ?? (Number.isInteger(xv) ? String(xv) : String(xv));
      g.fillStyle = C.dim; g.textAlign = "center"; g.textBaseline = "top"; g.fillText(lab, xx, plot.bottom + 8);
    });
    this.geo = { plot, mx, my, xmin, xmax };
    if (o.ycap) {                                          // lines that go beyond the cap run along the top edge
      const off = this.series.filter((s) => s.pts.some(([, y]) => y > yhi + 1e-9)).length;
      if (off) {
        const note = `${off} driver${off === 1 ? "" : "s"} beyond ${o.yfmt(yhi)} run along the top edge  -  hover a name for the real gap`;
        g.font = "11px 'Segoe UI', system-ui, sans-serif";
        const nw = g.measureText(note).width + 16;
        g.fillStyle = C.panel2; g.fillRect(plot.left + 8, plot.top + 6, Math.min(nw, plot.w - 16), 20);
        g.fillStyle = C.dim; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(note, plot.left + 16, plot.top + 16);
      }
    }
    const hov = this.hover !== null && this.hover < this.series.length ? this.hover : null;
    const order = this.series.map((_, k) => k).filter((k) => k !== hov);
    if (hov !== null) order.push(hov);                     // the hovered line is drawn last so it sits on top
    g.lineJoin = "round"; g.lineCap = "round";
    // every line is soft by default; the one under the mouse is drawn last, a little brighter and thicker.
    // The others look the same whether or not something is hovered, so nothing flickers.
    for (const i of order) {
      const s = this.series[i];
      if (!s.pts.length) continue;
      const col = safeColor(s.color);
      g.globalAlpha = i === hov ? 0.92 : (o.dots ? 0.72 : 0.41);
      g.strokeStyle = col; g.lineWidth = i === hov ? 3 : 2;
      if (s.dashed) {                                     // a trendline: thin and dashed, no points
        g.globalAlpha = 0.85; g.lineWidth = 1.8; g.setLineDash([7, 5]);
        g.beginPath(); s.pts.forEach(([x, y], j) => (j ? g.lineTo(mx(x), my(y)) : g.moveTo(mx(x), my(y)))); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        continue;
      }
      if (!o.dots) {
        g.beginPath();
        s.pts.forEach(([x, y], j) => (j && !LineChart.broken(s, s.pts[j - 1][0], x) ? g.lineTo(mx(x), my(y)) : g.moveTo(mx(x), my(y))));
        g.stroke();
      }
      if (o.dots || s.pts.length <= 40 || i === hov) {
        g.fillStyle = col;
        const rad = o.dots ? (i === hov ? 6.5 : 5) : (o.bigdots ? (i === hov ? 5.6 : 4.6) : (i === hov ? 4.2 : 3));
        for (const [x, y] of s.pts) { g.beginPath(); g.arc(mx(x), my(y), rad, 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
    }
    // key, in the order of the last value; hovering a name highlights its line
    let ly = t;
    const byValue = this.series.map((_, k) => k).sort((a, b2) => {
      const va = !o.invert && this.series[a].pts.length ? -this.series[a].pts[this.series[a].pts.length - 1][1] : 0;
      const vb = !o.invert && this.series[b2].pts.length ? -this.series[b2].pts[this.series[b2].pts.length - 1][1] : 0;
      return va - vb;
    });
    for (const i of byValue) {
      if (ly > H - 24) break;
      const s = this.series[i];
      const row = { x: W - legendW, y: ly - 1, w: legendW - 4, h: 18 };
      this.legendRows.push([i, row]);
      if (i === hov) { g.fillStyle = C.panel2; g.beginPath(); g.roundRect(row.x, row.y, row.w, row.h, 5); g.fill(); }
      g.globalAlpha = i === hov ? 0.92 : 0.41;
      g.fillStyle = safeColor(s.color); g.beginPath(); g.roundRect(W - legendW + 4, ly + 4, 12, 4, 2); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = i === hov ? C.hi : C.text; g.textAlign = "left"; g.textBaseline = "middle";
      g.font = `${i === hov ? "bold " : ""}11px 'Segoe UI', system-ui, sans-serif`;
      g.fillText(this.elide(g, s.label, legendW - 30), W - legendW + 22, ly + 8);
      g.globalAlpha = 1;
      ly += 18;
    }
    g.font = "11px 'Segoe UI', system-ui, sans-serif";
    // the value at the point nearest the mouse
    if (hov !== null && this.hoverPt) {
      const [x, y] = this.hoverPt, px = mx(x), py = my(y);
      const s = this.series[hov], col = safeColor(s.color);
      const xl = this.xlabels[x] ?? String(x);
      const line2 = `${xl}   ${o.yfmt(y)}`;
      g.font = "bold 11px 'Segoe UI', system-ui, sans-serif"; const w1 = g.measureText(s.label).width;
      g.font = "11px 'Segoe UI', system-ui, sans-serif"; const w2 = g.measureText(line2).width;
      const bw = Math.max(w1, w2) + 20, bh = 40;
      const bx = px + 14 + bw < plot.right ? px + 14 : px - 14 - bw;
      const by = py - bh - 10 > plot.top ? py - bh - 10 : py + 12;
      g.strokeStyle = col; g.lineWidth = 1.4; g.fillStyle = C.tip; g.beginPath(); g.roundRect(bx, by, bw, bh, 7); g.fill(); g.stroke();
      g.strokeStyle = C.hi; g.lineWidth = 1.6; g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.stroke();
      g.textAlign = "left"; g.textBaseline = "middle";
      g.font = "bold 11px 'Segoe UI', system-ui, sans-serif"; g.fillStyle = col; g.fillText(s.label, bx + 10, by + 12);
      g.font = "11px 'Segoe UI', system-ui, sans-serif"; g.fillStyle = C.text; g.fillText(line2, bx + 10, by + 28);
    }
  }

  elide(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
  }

  /* is a left-out x (the series' gaps) between these two points? then no line is drawn between them */
  static broken(s, x1, x2) { return !!s.gaps && s.gaps.some((v) => v > x1 && v < x2); }

  static segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(px - a[0], py - a[1]);
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }

  /* -> [series index, [x, y] of its nearest point] for what is under (px, py); [null, null] if nothing */
  hit(px, py) {
    const g = this.geo;
    if (!g) return [null, null];
    for (const [idx, r] of this.legendRows) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return [idx, null];
    const p = g.plot;
    if (px < p.left - 6 || px > p.right + 6 || py < p.top - 6 || py > p.bottom + 6) return [null, null];
    let best = 9, found = null;
    this.series.forEach((s, i) => {
      const q = s.pts.map(([x, y]) => [g.mx(x), g.my(y)]);
      let segs = q.length > 1 && !this.opt.dots ? q.slice(1).map((b, k) => [q[k], b]) : q.map((a) => [a, a]);
      if (q.length > 1 && !this.opt.dots) segs = segs.filter((_, k) => !LineChart.broken(s, s.pts[k][0], s.pts[k + 1][0]));
      for (const [a, b] of segs) {
        const d = LineChart.segDist(px, py, a, b);
        if (d < best) { best = d; found = i; }
      }
    });
    if (found === null) return [null, null];
    const near = this.series[found].pts.reduce((m, q) => (Math.abs(g.mx(q[0]) - px) < Math.abs(g.mx(m[0]) - px) ? q : m));
    return [found, near];
  }

  setHover(idx, pt) {
    if (idx !== this.hover || pt !== this.hoverPt) { this.hover = idx; this.hoverPt = pt; this.draw(); }
    this.cv.style.cursor = idx !== null ? "pointer" : "default";
  }

  onMove(e) {
    const r = this.cv.getBoundingClientRect();
    const [i, pt] = this.hit(e.clientX - r.left, e.clientY - r.top);
    this.setHover(i, pt);
  }

  /* a PNG with a title band on top, like the desktop program's Export image */
  png(title, sub) {
    const src = this.cv, dpr = window.devicePixelRatio || 1, band = 58 * dpr;
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height + band;
    const g = out.getContext("2d");
    g.fillStyle = cssVar("--bg"); g.fillRect(0, 0, out.width, out.height);
    g.textBaseline = "middle"; g.textAlign = "left";
    g.fillStyle = cssVar("--text"); g.font = `bold ${16 * dpr}px 'Segoe UI', system-ui, sans-serif`; g.fillText(title, 14 * dpr, 20 * dpr);
    g.fillStyle = cssVar("--dim"); g.font = `${12 * dpr}px 'Segoe UI', system-ui, sans-serif`; g.fillText(sub || "", 14 * dpr, 42 * dpr);
    g.drawImage(src, 0, band);
    return new Promise((res) => out.toBlob(res, "image/png"));
  }
}

/* a canvas with its chart, sized to fill its box */
function chartBox(height = 460) {
  const cv = h("canvas", { class: "chart", style: { height: height + "px" } });
  return { cv, chart: new LineChart(cv) };
}

/* Horizontal bars: the label on the left, the value after the bar; hover a bar for its details.
   items = [{ label, value, color, tip: [line, line ...] }] */
class BarChart {
  constructor(canvas) {
    this.cv = canvas; this.items = []; this.hover = null; this.mouse = null; this.empty = "No data yet";
    canvas._chart = this;
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onMove(e));
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.draw(); });
    canvas.style.touchAction = "pan-y";
    if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(items, empty) {
    this.items = items; this.hover = null; this.empty = empty || "No data yet";
    this.cv.style.height = Math.max(70, 16 + BarChart.ROW * items.length) + "px";
    this.draw();
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = { panel: cssVar("--panel"), text: cssVar("--text"), dim: cssVar("--dim"), hover: cssVar("--row-hover"), tip: cssVar("--tip-bg"), hi: cssVar("--hi") };
    g.fillStyle = C.panel; g.fillRect(0, 0, W, H);
    g.font = "13px 'Segoe UI', system-ui, sans-serif"; g.textBaseline = "middle";
    if (!this.items.length) { g.fillStyle = C.dim; g.textAlign = "center"; g.fillText(this.empty, W / 2, H / 2); return; }
    const narrow = W < 560, lw = Math.min(narrow ? 130 : 280, Math.max(...this.items.map((i) => g.measureText(i.label).width)) + 16);
    const vmax = Math.max(...this.items.map((i) => i.value)) || 1, bx0 = lw + 18, bx1 = Math.max(lw + 40, W - 56);
    this.items.forEach((it, n) => {
      const y = 8 + n * BarChart.ROW, mid = y + (BarChart.ROW - 2) / 2;
      if (n === this.hover) { g.fillStyle = C.hover; g.beginPath(); g.roundRect(6, y, W - 12, BarChart.ROW - 2, 6); g.fill(); }
      g.fillStyle = C.text; g.textAlign = "left"; g.fillText(this.elide(g, it.label, lw), 12, mid);
      const w = Math.max(2, ((bx1 - bx0) * it.value) / vmax);
      g.globalAlpha = this.hover !== null && n !== this.hover ? 0.59 : 1;
      g.fillStyle = safeColor(it.color); g.beginPath(); g.roundRect(bx0, y + 5, w, BarChart.ROW - 12, 4); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = n === this.hover ? C.text : C.dim; g.fillText(fmtPts(it.value), bx0 + w + 8, mid);
    });
    if (this.hover !== null && this.mouse) {
      const lines = this.items[this.hover].tip || [];
      if (lines.length) {
        g.font = "bold 12px 'Segoe UI', system-ui, sans-serif";
        const w = Math.max(...lines.map((l, i) => { g.font = `${i ? "" : "bold "}12px 'Segoe UI', system-ui, sans-serif`; return g.measureText(l).width; })) + 20, h = lines.length * 18 + 12;
        const x = this.mouse.x + 14 + w < W ? this.mouse.x + 14 : this.mouse.x - 14 - w, y = Math.max(4, Math.min(H - h - 4, this.mouse.y - h / 2));
        g.fillStyle = C.tip; g.strokeStyle = safeColor(this.items[this.hover].color); g.lineWidth = 1.4;
        g.beginPath(); g.roundRect(x, y, w, h, 7); g.fill(); g.stroke();
        lines.forEach((l, i) => { g.font = `${i ? "" : "bold "}12px 'Segoe UI', system-ui, sans-serif`; g.fillStyle = i ? C.text : safeColor(this.items[this.hover].color); g.textAlign = "left"; g.fillText(l, x + 10, y + 16 + i * 18); });
      }
    }
  }

  elide(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
  }

  onMove(e) {
    const r = this.cv.getBoundingClientRect(), y = e.clientY - r.top, n = Math.floor((y - 8) / BarChart.ROW);
    this.hover = n >= 0 && n < this.items.length ? n : null;
    this.mouse = { x: e.clientX - r.left, y };
    this.cv.style.cursor = this.hover !== null ? "pointer" : "default";
    this.draw();
  }
}
BarChart.ROW = 28;

function barBox() {
  const cv = h("canvas", { class: "chart bars" });
  return { cv, chart: new BarChart(cv) };
}

/* A donut with its key.  Hover a slice or a name in the key to see it.
   items = [{ label, value, color, tip: [line, ...] }], centre = [big text, small text] */
const PIE_COLORS = ["#ff3d4f", "#4da3ff", "#ffc83d", "#3ddc84", "#b061ff", "#ff8a3d", "#2fd6d6", "#ff6bb5", "#9ad14b", "#7d8cff",
  "#e0c36a", "#5ee0b0", "#d96b6b", "#6bb5d9", "#c28cff", "#ffa94d"];

function sliceColor(i) {
  const c = PIE_COLORS[i % PIE_COLORS.length];
  if (i < PIE_COLORS.length) return c;
  const n = parseInt(c.slice(1), 16);                          // after one round of the palette: the same colours, darker
  const f = (v) => Math.round(v * 0.75);
  return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

class PieChart {
  constructor(canvas) {
    this.cv = canvas; this.items = []; this.hover = null; this.mouse = null; this.centre = ["", ""]; this.empty = "No data yet";
    canvas._chart = this;
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onMove(e));
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.draw(); });
    canvas.style.touchAction = "pan-y";
    if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(items, centre, empty) {
    this.items = items; this.centre = centre || ["", ""]; this.hover = null; this.empty = empty || "No data yet";
    this.draw();
  }

  /* where everything goes; wide: the key beside the donut, narrow: below it */
  geo() {
    const W = this.cv.clientWidth, n = this.items.length, narrow = W < 600;
    if (narrow) {
      const side = Math.max(140, Math.min(W - 40, 280));
      return { W, narrow, cx: W / 2, cy: 18 + side / 2, R: side / 2, lx: 16, ly: 18 + side + 20, kw: W - 32, H: 18 + side + 20 + n * PieChart.ROW + 14 };
    }
    const side = 280, cx = 22 + side / 2, lx = cx + side / 2 + 36;
    return { W, narrow, cx, cy: Math.max(150, (30 + n * PieChart.ROW) / 2 + 6), R: side / 2, lx, ly: 0, kw: Math.min(440, W - lx - 14), H: Math.max(300, 30 + n * PieChart.ROW) };
  }

  draw() {
    const cv = this.cv, W = cv.clientWidth;
    if (!W) return;
    const g0 = this.geo(), need = this.items.length ? g0.H : 140;
    if (Math.abs(cv.clientHeight - need) > 1) { cv.style.height = need + "px"; return; }      // the resize observer draws again
    const dpr = window.devicePixelRatio || 1, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = { panel: cssVar("--panel"), panel2: cssVar("--panel2"), text: cssVar("--text"), dim: cssVar("--dim"), hover: cssVar("--row-hover"), tip: cssVar("--tip-bg") };
    g.fillStyle = C.panel; g.fillRect(0, 0, W, H);
    const total = this.items.reduce((s, i) => s + i.value, 0);
    if (!total) { g.fillStyle = C.dim; g.font = "13px 'Segoe UI', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(this.empty, W / 2, H / 2); return; }
    const { cx, cy, R, lx, ly, kw, narrow } = g0, r = R * 0.58;
    let a = -Math.PI / 2;
    this.items.forEach((it, n) => {
      const span = (2 * Math.PI * it.value) / total;
      if (span <= 0) return;
      const mid = a + span / 2, off = n === this.hover ? 7 : 0;
      g.save(); g.translate(Math.cos(mid) * off, Math.sin(mid) * off);
      g.beginPath(); g.arc(cx, cy, R, a, a + span); g.arc(cx, cy, r, a + span, a, true); g.closePath();
      g.globalAlpha = this.hover !== null && n !== this.hover ? 0.65 : 1;
      g.fillStyle = safeColor(it.color); g.fill();
      g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = C.panel; g.stroke();
      g.restore();
      a += span;
    });
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = C.text; g.font = "bold 22px 'Segoe UI', system-ui, sans-serif"; g.fillText(String(this.centre[0]), cx, cy - 8);
    g.fillStyle = C.dim; g.font = "12px 'Segoe UI', system-ui, sans-serif"; g.fillText(String(this.centre[1]), cx, cy + 14);
    // the key
    g.font = "13px 'Segoe UI', system-ui, sans-serif"; g.textAlign = "left";
    const y0 = narrow ? ly : Math.max(12, (H - this.items.length * PieChart.ROW) / 2);
    this.items.forEach((it, n) => {
      const y = y0 + n * PieChart.ROW, mid = y + (PieChart.ROW - 2) / 2;
      if (n === this.hover) { g.fillStyle = C.hover; g.beginPath(); g.roundRect(lx - 8, y, kw + 16, PieChart.ROW - 2, 6); g.fill(); }
      g.globalAlpha = this.hover !== null && n !== this.hover ? 0.65 : 1;
      g.fillStyle = safeColor(it.color); g.beginPath(); g.roundRect(lx, y + 6, 12, 12, 3); g.fill();
      g.globalAlpha = 1;
      const val = `${fmtPts(it.value)}  ·  ${Math.round((100 * it.value) / total)}%`, vw = g.measureText(val).width;
      g.fillStyle = n === this.hover ? C.text : C.dim; g.textAlign = "right"; g.fillText(val, lx + kw, mid);
      g.fillStyle = C.text; g.textAlign = "left"; g.fillText(this.elide(g, it.label, Math.max(40, kw - vw - 34)), lx + 20, mid);
    });
    if (this.hover !== null && this.mouse) this.tooltip(g, W, H, C);
  }

  tooltip(g, W, H, C) {
    const it = this.items[this.hover], lines = it.tip || [];
    if (!lines.length) return;
    const fnt = (i) => `${i ? "" : "bold "}12px 'Segoe UI', system-ui, sans-serif`;
    const w = Math.max(...lines.map((l, i) => { g.font = fnt(i); return g.measureText(l).width; })) + 20, h = lines.length * 18 + 12;
    const x = Math.max(4, Math.min(W - w - 4, this.mouse.x + 14)), y = Math.max(4, Math.min(H - h - 4, this.mouse.y - h / 2));
    g.fillStyle = C.tip; g.strokeStyle = safeColor(it.color); g.lineWidth = 1.4; g.beginPath(); g.roundRect(x, y, w, h, 7); g.fill(); g.stroke();
    lines.forEach((l, i) => { g.font = fnt(i); g.fillStyle = i ? C.text : safeColor(it.color); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(l, x + 10, y + 16 + i * 18); });
  }

  elide(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
  }

  hit(px, py) {
    const total = this.items.reduce((s, i) => s + i.value, 0);
    if (!total) return null;
    const { cx, cy, R, lx, ly, kw, narrow, H } = this.geo();
    const y0 = narrow ? ly : Math.max(12, (H - this.items.length * PieChart.ROW) / 2);
    if (px >= lx - 8 && px <= lx + kw + 8 && py >= y0) { const n = Math.floor((py - y0) / PieChart.ROW); return n < this.items.length ? n : null; }
    const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy);
    if (d < R * 0.58 - 2 || d > R + 10) return null;
    let ang = Math.atan2(dy, dx) + Math.PI / 2;                 // clockwise from the top
    if (ang < 0) ang += 2 * Math.PI;
    let acc = 0;
    for (let n = 0; n < this.items.length; n++) { acc += (2 * Math.PI * this.items[n].value) / total; if (ang < acc) return n; }
    return this.items.length - 1;
  }

  onMove(e) {
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    this.hover = this.hit(x, y); this.mouse = { x, y };
    this.cv.style.cursor = this.hover !== null ? "pointer" : "default";
    this.draw();
  }
}
PieChart.ROW = 24;

function pieBox() {
  const cv = h("canvas", { class: "chart pie" });
  return { cv, chart: new PieChart(cv) };
}
