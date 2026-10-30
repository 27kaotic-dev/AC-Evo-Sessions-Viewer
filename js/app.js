"use strict";
/* ACE Sessions Viewer: reads the data the desktop program publishes (data/index.json and one file per session),
   or any AC EVO result files you open or drop on the page.  Read-only. */

const S = { sessions: [], names: {}, style: "full", tab: "sessions", local: new Set(), note: "" };
const TABS = [["sessions", "Sessions"], ["tracks", "Tracks"], ["drivers", "Drivers"], ["h2h", "Head-to-head"]];
const STYLES = [["full", "Full name"], ["nick", "Nickname"], ["both", "Full name (nickname)"]];

/* ---------------------------------------------------------------- theme */
function getTheme() {
  try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") return t; } catch (e) { /* storage blocked */ }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (e) { /* storage blocked */ }
}
function toggleTheme() { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); renderAll(); }
const ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" fill="currentColor"/></svg>';
function themeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  const b = h("button", { class: "theme", type: "button", "aria-label": dark ? "Switch to light mode" : "Switch to dark mode", title: dark ? "Switch to light mode" : "Switch to dark mode", onclick: toggleTheme });
  b.append(h("span", { class: "slot" }), h("span", { class: "slot" }), h("span", { class: "knob" }));
  b.children[0].innerHTML = ICON_SUN;       // fixed markup, no data in it
  b.children[1].innerHTML = ICON_MOON;
  return b;
}

/* ---------------------------------------------------------------- shell */
function recompute() { S.names = driverNames(S.sessions, S.style); }

function renderAll() {
  const app = document.getElementById("app");
  clear(app);
  const file = h("input", { type: "file", accept: ".json,application/json", multiple: true, hidden: true, onchange: (e) => { addFiles([...e.target.files]); e.target.value = ""; } });
  const pids = new Set(S.sessions.flatMap((s) => s.entries.map((e) => e.pid)));
  const sub = S.sessions.length ? `${S.sessions.length} sessions · ${pids.size} drivers · ${new Set(S.sessions.map((s) => trackKey(s.track, s.layout))).size} tracks` : "";
  const styleSel = h("select", { "aria-label": "Driver names", onchange: () => { S.style = styleSel.value; try { localStorage.setItem("name_style", S.style); } catch (e) { /* storage blocked */ } recompute(); renderView(); } },
    STYLES.map(([v, t]) => option(v, t, v === S.style)));
  const bar = h("header", { class: "top" },
    h("div", { class: "brand" }, h("img", { src: "icon.svg", alt: "", width: 30, height: 30 }), h("div", null, h("div", { class: "app", text: "ACE Sessions Viewer" }), h("div", { class: "cname", text: sub }))),
    h("div", { class: "grow" }), field("Names:", styleSel),
    h("button", { class: "btn", type: "button", text: "Open files…", title: "Show AC EVO session result files (they stay in your browser, nothing is uploaded)", onclick: () => file.click() }), file, themeToggle());
  const nav = h("nav", { class: "tabs", role: "tablist" }, TABS.map(([id, label]) => h("button", { class: "tab" + (S.tab === id ? " on" : ""), type: "button", role: "tab",
    "aria-selected": S.tab === id, onclick: () => setTab(id), text: label })));
  const main = h("main", { id: "view" });
  app.append(bar, S.sessions.length ? nav : null, main, h("footer", { class: "foot" }, "Read-only viewer. Made with ACE Practice Laps."));
  if (S.sessions.length) renderView(); else main.append(emptyState());
}

function renderView() {
  const main = document.getElementById("view");
  clear(main);
  const views = { sessions: viewSessions, tracks: viewTracks, drivers: viewDrivers, h2h: viewH2h };
  main.append(views[S.tab]());
  if (S.note) main.prepend(h("div", { class: "hint", text: S.note }));
  document.querySelectorAll(".tabs .tab").forEach((b, i) => { const on = TABS[i][0] === S.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
}
function setTab(id) { S.tab = id; renderView(); window.scrollTo({ top: 0 }); }

function emptyState() {
  return h("div", { class: "empty big" }, h("p", { text: "No sessions yet." }),
    h("p", { class: "dim", text: "Use “Open files…” (or drop AC EVO session result files here) to look at them. They stay in your browser." }));
}

/* ---------------------------------------------------------------- loading */
function showError(e) {
  const main = document.getElementById("view");
  const box = h("div", { class: "error", role: "alert", text: e.message || String(e) });
  if (main) main.prepend(box); else document.getElementById("app").append(box);
  setTimeout(() => box.remove(), 9000);
}

function readText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Could not read " + file.name)); r.readAsText(file); });
}

/* result files (or sessions this program published) opened by hand: kept in the browser only */
async function addFiles(files) {
  let added = 0, dupes = 0, bad = 0;
  const have = new Set(S.sessions.map((s) => s.id));
  for (const f of files) {
    try {
      const root = JSON.parse(await readText(f));
      let sess = null;
      if (isSessionFile(root)) sess = parseSession(root, f.name, f.lastModified);
      else if (root && root.id && Array.isArray(root.entries) && root.drivers) sess = root;
      if (!sess || !sess.entries.length) { bad++; continue; }
      if (have.has(sess.id)) { dupes++; continue; }
      have.add(sess.id); S.sessions.push(sess); S.local.add(sess.id); added++;
    } catch (e) { bad++; }
  }
  recompute();
  S.note = `${added} session${added === 1 ? "" : "s"} added (only in this browser)` + (dupes ? `, ${dupes} already shown` : "") + (bad ? `, ${bad} not a session result` : "");
  renderAll();
}

async function boot() {
  setTheme(getTheme());
  try { const n = localStorage.getItem("name_style"); if (n === "nick" || n === "both" || n === "full") S.style = n; } catch (e) { /* storage blocked */ }
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
  renderAll();
  try {
    const r = await fetch("data/index.json", { cache: "no-cache" });
    const index = r.ok ? await r.json() : null;
    const items = index && Array.isArray(index.sessions) ? index.sessions.filter((x) => x && typeof x.file === "string" && /^[\w./-]+\.json$/.test(x.file) && !x.file.includes("..")) : [];
    const loaded = await Promise.all(items.map((x) => fetch("data/" + x.file, { cache: "no-cache" }).then((q) => (q.ok ? q.json() : null)).catch(() => null)));
    S.sessions = loaded.filter((s) => s && s.id && Array.isArray(s.entries) && s.drivers);
  } catch (e) { /* no data folder: the page still works with opened files */ }
  recompute();
  renderAll();
}
boot();
