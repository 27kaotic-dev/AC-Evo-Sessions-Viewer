"use strict";
/* Small helpers shared by the viewer: DOM building, time / points formatting, CSV and image download.
   Everything that comes from a data file goes in with textContent, never innerHTML. */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/* Python's round(): halves go to the even number, so times print exactly as in the desktop program */
function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function fmtTime(ms) {
  if (ms === null || ms === undefined || ms <= 0) return "-";
  ms = pyRound(ms);
  const hh = Math.floor(ms / 3600000); let rem = ms % 3600000;
  const m = Math.floor(rem / 60000); rem %= 60000;
  const s = Math.floor(rem / 1000), milli = rem % 1000;
  const p2 = (n) => String(n).padStart(2, "0");
  return (hh ? `${hh}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`) + "." + String(milli).padStart(3, "0");
}

function fmtGap(ms) {
  if (ms <= 0) return "-";
  ms = pyRound(ms);
  const m = Math.floor(ms / 60000), rem = ms % 60000;
  const s = Math.floor(rem / 1000), milli = String(rem % 1000).padStart(3, "0");
  return m ? `+${m}:${String(s).padStart(2, "0")}.${milli}` : `+${s}.${milli}`;
}

function fmtPts(x) {
  if (x === null || x === undefined) return "";
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  return x.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function ordinal(n) {
  if (n === null || n === undefined) return "-";
  const r = n % 100, suf = (r >= 10 && r <= 20) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return n + suf;
}

/* colours from the data file are only ever used if they look like #rrggbb */
function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#8a92a8"; }

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function medalColor(pos) { return { 1: cssVar("--gold"), 2: cssVar("--silver"), 3: cssVar("--bronze") }[pos] || null; }
function medalClass(pos) { return { 1: "m1", 2: "m2", 3: "m3" }[pos] || ""; }

function slug(text) { return String(text).replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "export"; }

function download(name, blob) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* a table element -> CSV text (cells keep their visible text; colour swatch columns have no text) */
function tableToCsv(table) {
  const rows = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.children].map((c) => (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim());
    if (cells.some((c) => c !== "")) rows.push(cells);
  }
  const q = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

function downloadCsv(name, table) { download(name + ".csv", new Blob([tableToCsv(table)], { type: "text/csv;charset=utf-8" })); }

function option(value, text, selected) { return h("option", { value, text, selected: selected || false }); }

/* A table taller than the screen scrolls inside the page, so its sideways scroll bar is always in view (no need to scroll
   to the bottom of a long table first).  The height is what is left of the window below the top of the table. */
let fitQueued = false;
function fitTables() {
  fitQueued = false;
  document.querySelectorAll(".tablewrap").forEach((w) => {
    if (!w.offsetParent || w.classList.contains("listwrap")) return;      // on a tab that is not showing / a short list of choices
    const top = w.getBoundingClientRect().top + window.scrollY;
    const want = Math.max(280, Math.floor(window.innerHeight - top - 24)) + "px";
    if (w.style.maxHeight !== want) w.style.maxHeight = want;
  });
}
function queueFit() { if (!fitQueued) { fitQueued = true; setTimeout(fitTables, 30); } }
window.addEventListener("resize", queueFit);
window.addEventListener("load", queueFit);
if (window.MutationObserver) new MutationObserver(queueFit).observe(document.documentElement, { childList: true, subtree: true });
if (window.ResizeObserver) new ResizeObserver(queueFit).observe(document.documentElement);

/* a label and its control kept together when the toolbar wraps */
function field(text, ...controls) { return h("span", { class: "field" }, h("label", { text }), controls); }

/* ---------------------------------------------------------------- dates
   Dates are kept as YYYY-MM-DD.  Typed dates (15-10-26, 10/15/2026) are read in the viewer's own date order, unless that
   gives no real date; they are shown the way the viewer's browser writes dates. */
let DATE_ORDER_OVERRIDE = null;          // tests set this to "DMY", "MDY" or "YMD"

function dateOrder() {
  if (DATE_ORDER_OVERRIDE) return DATE_ORDER_OVERRIDE;
  try {
    const o = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2001, 10, 25))
      .filter((p) => p.type === "day" || p.type === "month" || p.type === "year").map((p) => p.type[0].toUpperCase()).join("");
    if (o.length === 3) return o;
  } catch (e) { /* fall through */ }
  return "DMY";
}

function normDate(text, order) {
  const raw = String(text || "").trim(), s = raw.replace(/\s+/g, "").replace(/\.$/, "");
  const real = (y, mo, d) => { const t = new Date(Date.UTC(y, mo - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null; };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (m) return real(+m[1], +m[2], +m[3]) || raw;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!m) return raw;
  const a = +m[1], b = +m[2], c = +m[3], yy = c < 100 ? c + 2000 : c;
  order = order || dateOrder();
  const cands = order === "YMD" && m[3].length === 2 ? [[a + 2000, b, c], [yy, b, a]]
    : (order === "MDY" ? [[yy, a, b], [yy, b, a]] : [[yy, b, a], [yy, a, b]]);
  for (const [y, mo, d] of cands) { const r = real(y, mo, d); if (r) return r; }
  return raw;
}

function fmtDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "");
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(t) ? String(iso) : t.toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
}
