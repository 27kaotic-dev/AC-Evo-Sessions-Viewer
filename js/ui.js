"use strict";
/* Small building blocks shared by the pages: sub tabs, chips, sizeable tables.  (Same as the championship viewer.) */

/* ---------------------------------------------------------------- small building blocks */
const TABMEM = {};      // the sub-tab last open per page, so picking another session / track / driver stays on it
function tabset(items, start = 0, key = "") {
  const bar = h("div", { class: "subtabs", role: "tablist" });
  const body = h("div", { class: "subbody" });
  const panes = [], btns = [];
  let cur = -1;
  function show(i) {
    cur = i;
    if (key) TABMEM[key] = i;
    btns.forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-selected", k === i); });
    items.forEach((it, k) => {
      if (k === i && !panes[k]) { panes[k] = h("div", { class: "pane" }, it.make()); body.append(panes[k]); }
      if (panes[k]) panes[k].hidden = k !== i;
    });
  }
  items.forEach((it, i) => {
    const b = h("button", { class: "subtab", type: "button", role: "tab", onclick: () => show(i) }, it.title);
    btns.push(b); bar.append(b);
  });
  show(Math.max(0, Math.min(key && TABMEM[key] !== undefined ? TABMEM[key] : start, items.length - 1)));
  return { el: h("div", { class: "tabset" }, bar, body), show, get index() { return cur; } };
}

function chip(title, value, color) {
  return h("div", { class: "chip" }, h("div", { class: "chip-t", text: title.toUpperCase() }),
    h("div", { class: "chip-v", style: color ? { color } : null, text: String(value) }));
}

/* column headings follow their column: centred over centred / number columns, left over names and text */
const HEAD_TIPS = {
  "Pos": "Position by best valid lap",
  "No.": "Race number",
  "Best lap": "Fastest lap the game counted",
  "Gap": "Behind the fastest lap",
  "Interval": "Behind the driver ranked just above",
  "Ideal lap": "Best sector 1, 2 and 3 added together",
  "Laps": "Laps driven",
  "Valid": "Laps the game counted (no track cut)",
  "Valid laps": "Laps the game counted (no track cut)",
  "Best S1": "Best sector 1 from any valid lap",
  "Best S2": "Best sector 2 from any valid lap",
  "Best S3": "Best sector 3 from any valid lap",
  "Consistency": "Steadiness out of 100 (see the Consistency tab of a session)",
  "Average lap": "Average of the counted laps",
  "Std. deviation": "Spread of the laps around the average. Bigger = less steady",
  "Laps counted": "Valid laps within 8% of the best lap",
  "Run": "A stretch of laps. It ends at a slow lap (pit, out or cool-down lap)",
  "Best vs previous run": "Change in best lap since the previous run (green = quicker)",
  "Invalid laps": "Laps the game did not count",
  "Invalid lap numbers": "Which laps were not counted",
  "Track cut warnings": "Times the game warned of cutting the track",
  "Pit speeding": "Pit lane speeding penalties",
  "Collisions": "Contacts, with cars or anything else",
  "With cars": "Of the collisions, contacts with other cars",
  "Type": "Practice, qualifying or race",
  "Weather": "Dry, damp, wet or mixed: picked when the sessions are imported",
  "Drivers": "Drivers in the session",
  "Fastest lap": "Best valid lap of the session",
  "Server": "Server the session was run on",
  "Sessions": "Sessions driven",
  "Rank": "Position on the track's leaderboard",
  "Track record": "Fastest valid lap at the track, from any driver",
  "Gap to record": "Best lap behind the track record",
  "Best time": "Fastest time in this sector, from any driver",
  "Second best": "Second fastest time in this sector",
  "Position": "Place in the session by best lap",
  "Sector 1": "Rank of their best sector 1 among every driver at the track, and the time behind the quickest",
  "Sector 2": "Rank of their best sector 2 among every driver at the track, and the time behind the quickest",
  "Sector 3": "Rank of their best sector 3 among every driver at the track, and the time behind the quickest",
  "Strongest": "The sector where they rank best compared with the field",
  "Weakest": "The sector where they rank worst compared with the field",
};
/* tips: an array (one text per column) or an object {heading: text} for the columns that mean something else in this table */
function table(heads, rows, cls, tips) {
  const tipOf = (x, i) => (Array.isArray(tips) ? tips[i] : tips && tips[x]) || HEAD_TIPS[x] || null;
  const first = rows.length ? rows[0].children : [];
  const align = (i) => (first[i] && /(^|\s)[cr](\s|$)/.test(first[i].className) ? "c" : "");
  const tbl = h("table", { class: "dt " + (cls || "") },
    h("thead", null, h("tr", null, heads.map((x, i) => h("th", { class: align(i), title: tipOf(x, i) }, x)))), h("tbody", null, rows));
  makeSizeable(tbl, heads.join("|") + "|" + (cls || ""));
  return h("div", { class: "tablewrap" }, tbl);
}

/* every column of a table can be dragged wider or narrower (the right edge of its heading); double-click puts the table back.
   The widths are kept while the page is open, so they are still there when you change race or tab. */
const COL_W = {};
function makeSizeable(tbl, key) {
  const ths = [...tbl.querySelectorAll("thead th")];
  const apply = (w) => {
    ths.forEach((th, i) => { th.style.width = th.style.minWidth = th.style.maxWidth = w[i] + "px"; });
    tbl.style.tableLayout = "fixed"; tbl.style.width = w.reduce((a, b) => a + b, 0) + "px"; tbl.classList.add("sized");
  };
  if (COL_W[key] && COL_W[key].length === ths.length) apply(COL_W[key]);
  ths.forEach((th, i) => {
    const g = h("span", { class: "grip", title: "Drag to change the width of this column (double-click: back to normal)", onclick: (e) => e.stopPropagation(),
      ondblclick: (e) => {
        e.stopPropagation(); delete COL_W[key];
        ths.forEach((t) => { t.style.width = t.style.minWidth = t.style.maxWidth = ""; });
        tbl.style.tableLayout = tbl.style.width = ""; tbl.classList.remove("sized");
      } });
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch (err) { /* no capture: the move events still arrive while the pointer is over the handle */ }
      const w = COL_W[key] && COL_W[key].length === ths.length ? [...COL_W[key]] : ths.map((t) => Math.round(t.getBoundingClientRect().width));
      const x0 = e.clientX, w0 = w[i];
      const move = (ev) => { w[i] = Math.max(40, Math.round(w0 + ev.clientX - x0)); COL_W[key] = w; apply(w); };
      const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up);
    });
    th.append(g);
  });
}

function td(content, cls, style) { return h("td", { class: cls || "", style: style || null }, content); }
function nameTd(name, color, onclick) {
  return h("td", { class: "nm" + (onclick ? " link" : ""), onclick }, h("span", { class: "bar", style: { background: safeColor(color) } }), h("span", { text: name }));
}
const pc = (cond, cls) => (cond ? cls : "");
