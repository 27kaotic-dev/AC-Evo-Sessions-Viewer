"use strict";
/* The four pages: Sessions, Tracks, Drivers and Head-to-head.  They mirror the desktop program. */

const H2H_A = "#ff3d4f", H2H_B = "#4da3ff";                      // the two drivers of a head to head
const DRIVER_COLORS = ["#ff3d4f", "#4da3ff", "#ffc83d", "#3ddc84", "#b061ff", "#ff8a3d", "#2fd6d6", "#ff6bb5", "#9ad14b", "#7d8cff",
  "#e0c36a", "#5ee0b0", "#d96b6b", "#6bb5d9", "#c28cff", "#ffa94d"];
const P = { sessions: { track: "", type: "", weather: "", sel: "" }, tracks: { sel: "", car: "", period: 0, weather: "" }, drivers: { sel: "" }, h2h: { a: "", b: "" } };

/* ---------------------------------------------------------------- shared bits */
const allSessions = () => S.sessions;
const nameOf = (pid) => (S.names || {})[pid] || pid;
function colorOf(pid) { const ids = Object.keys(S.names || {}).sort(); const i = ids.indexOf(pid); return DRIVER_COLORS[(i < 0 ? 0 : i) % DRIVER_COLORS.length]; }
const timeAxis = (v) => (pyRound(v) % 1000 === 0 ? fmtTime(v).slice(0, -4) : fmtTime(v));

function lapTd(ms, o = {}) {
  const cls = "c " + (o.best ? "purple b" : o.mine ? "green b" : o.invalid ? "bad it" : "");
  return h("td", { class: cls, title: o.invalid ? "The game did not count this lap (track cut or invalid)" : o.star ? "The track record" : null, text: (o.star ? "\u2605 " : "") + fmtTime(ms) });
}
function pairChip(title, a, b) {
  return h("div", { class: "chip" }, h("div", { class: "chip-t", text: title.toUpperCase() }),
    h("div", { class: "chip-v" }, h("span", { style: { color: H2H_A }, text: String(a) }), h("span", { class: "dim", text: " - " }), h("span", { style: { color: H2H_B }, text: String(b) })));
}
function shortNames(a, b) {
  const ini = (n) => { const w = String(n).trim().split(/\s+/); return "(" + (w.length > 1 ? [w[0], w[w.length - 1]] : w.slice(0, 1)).map((x) => x.charAt(0).toUpperCase()).join(".") + ")"; };
  const ia = ini(a), ib = ini(b);
  if (ia === ib) { const last = (n) => String(n).trim().split(/\s+/).pop(); return [last(a), last(b)]; }
  return [ia, ib];
}
function lineBox(series, opt, note, height = 440) {
  const { cv, chart } = chartBox(height);
  chart.setData(series, Object.assign({ integer: true, unit: 1000, yfmt: timeAxis }, opt || {}));
  return h("div", { class: "chartwrap" }, cv, h("div", { class: "hint", text: note + " Hover a line or a name in the key to highlight it." }));
}
/* a clickable list: the table of choices at the top of a page */
function listTable(heads, rows, onPick, selected) {
  const trs = rows.map((r) => {
    const tr = h("tr", { class: "link" + (r.id === selected ? " focus" : ""), onclick: () => { onPick(r.id); }, id: "row-" + r.id }, r.cells);
    return tr;
  });
  const w = table(heads, trs, "list");
  w.classList.add("listwrap");
  return w;
}
const rowLink = (sid) => ({ ondblclick: () => openSession(sid), title: "Double-click to open the session", style: { cursor: "pointer" } });
const CLICK_HINT = "  Click a point to open that session.";
/* the "Show laps" box of the lap charts (remembered in this browser): laps further than this from the driver's median lap are left out */
const LAP_FILTERS = [["0", "All laps"], ["0.1", "Within 10%"], ["0.06", "Within 6%"], ["0.04", "Within 4%"], ["0.02", "Within 2%"]];
function outlierPct() { try { const v = localStorage.getItem("lap_outlier"); if (v !== null && LAP_FILTERS.some(([k]) => k === v)) return +v; } catch (e) { /* storage blocked */ } return OUTLIER; }
function outlierPicker(onchange) {
  const cur = String(outlierPct());
  return selectOf("Show laps:", LAP_FILTERS.some(([k]) => k === cur) ? cur : "0.1", LAP_FILTERS,
    (v) => { try { localStorage.setItem("lap_outlier", v); } catch (e) { /* storage blocked */ } onchange(); });
}
function weatherCell(s) {
  const c = td(s.weather || "Not set", "c" + (s.weather ? "" : " dim"));
  if (WEATHER_API) { c.classList.add("wxcell"); c.title = "Click to set the weather (PIN needed)"; c.addEventListener("click", (e) => { e.stopPropagation(); weatherEditor(s, c); }); }
  return c;
}
function pickerBar(...kids) { return h("div", { class: "toolbar" }, kids); }
const WEATHERS = [["", "All weather"], ["Dry", "Dry"], ["Damp", "Damp"], ["Wet", "Wet"], ["Mixed", "Mixed"], ["-", "Not set"]];
const weatherOk = (s, w) => !w || (w === "-" ? !s.weather : s.weather === w);
function selectOf(label, value, options, onchange) {
  const sel = h("select", { "aria-label": label, onchange: () => onchange(sel.value) }, options.map(([v, t]) => option(v, t, String(v) === String(value))));
  return field(label, sel);
}
const csvButton = (getTable, name) => h("button", { class: "btn", type: "button", text: "Export CSV", title: "Save the table that is showing as CSV",
  onclick: () => { const t = getTable(); if (t) downloadCsv(slug(name()), t); } });
function visibleTable(root) { return [...root.querySelectorAll(".pane:not([hidden]) table, table")].find((t) => t.offsetParent && !t.closest(".listwrap")); }
function noData(text) { return h("div", { class: "empty", text }); }

/* ---------------------------------------------------------------- weather editor (click a weather cell; the PIN is asked once per tab) */
function closeWeatherEditor() { document.querySelectorAll(".wxpop").forEach((e) => e.remove()); }
function weatherEditor(sess, cell) {
  closeWeatherEditor();
  let pin = ""; try { pin = sessionStorage.getItem("weather_pin") || ""; } catch (e) { /* storage blocked */ }
  const sel = h("select", { "aria-label": "Weather" }, [["", "Not set"], ["Dry", "Dry"], ["Damp", "Damp"], ["Wet", "Wet"], ["Mixed", "Mixed"]].map(([v, t]) => option(v, t, v === (sess.weather || ""))));
  const pinBox = h("input", { type: "password", placeholder: "PIN", autocomplete: "off", "aria-label": "PIN", value: pin });
  const msg = h("div", { class: "hint" });
  const save = h("button", { class: "btn", type: "button", text: "Save", onclick: async () => {
    msg.textContent = "Saving…"; save.disabled = true;
    try {
      const r = await fetch(WEATHER_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pinBox.value, id: sess.id, weather: sel.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || `Could not save (${r.status})`; save.disabled = false; if (r.status === 403) { try { sessionStorage.removeItem("weather_pin"); } catch (e) { /* ignore */ } } return; }
      try { sessionStorage.setItem("weather_pin", pinBox.value); } catch (e) { /* storage blocked */ }
      sess.weather = sel.value;
      closeWeatherEditor();
      renderView();
    } catch (e) { msg.textContent = "Could not reach the server"; save.disabled = false; }
  } });
  const pop = h("div", { class: "wxpop" }, h("div", { class: "wxt", text: `Weather: ${trackLabel(sess.track, sess.layout)}, ${fmtDate(sess.date)}` }), sel, pin ? null : pinBox,
    h("div", { class: "wxrow" }, save, h("button", { class: "btn", type: "button", text: "Cancel", onclick: closeWeatherEditor })), msg);
  if (pin) pop.append(h("a", { class: "wxlink", href: "#", text: "Use a different PIN", onclick: (e) => { e.preventDefault(); try { sessionStorage.removeItem("weather_pin"); } catch (x) { /* ignore */ } weatherEditor(sess, cell); } }));
  document.body.append(pop);
  const r = cell.getBoundingClientRect();
  pop.style.top = Math.min(window.scrollY + r.bottom + 4, window.scrollY + window.innerHeight - 200) + "px";
  pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 270)) + "px";
  (pin ? sel : pinBox).focus();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWeatherEditor(); });

/* ---------------------------------------------------------------- sessions */
function viewSessions() {
  const root = h("div", { class: "page" });
  const st = P.sessions;
  const all = sortedSessions(allSessions());
  const tracks = statsTracks(all), types = [...new Set(all.map((s) => s.type).filter(Boolean))].sort();
  const list = [...all].reverse().filter((s) => (!st.track || trackKey(s.track, s.layout) === st.track) && (!st.type || s.type === st.type) && weatherOk(s, st.weather));
  if (!list.some((s) => s.id === st.sel)) st.sel = list.length ? list[0].id : "";
  const detail = h("div");
  const bar = pickerBar(
    selectOf("Track:", st.track, [["", "All tracks"], ...tracks.map((t) => [t.tkey, trackLabel(t.track, t.layout)])], (v) => { st.track = v; rerender(); }),
    selectOf("Type:", st.type, [["", "All types"], ...types.map((t) => [t, t])], (v) => { st.type = v; rerender(); }),
    selectOf("Weather:", st.weather, WEATHERS, (v) => { st.weather = v; rerender(); }),
    h("span", { class: "grow" }), csvButton(() => visibleTable(detail), () => { const s = list.find((x) => x.id === st.sel); return s ? `${s.track}_${s.date}` : "session"; }));
  function pick(id) {
    st.sel = id;
    root.querySelectorAll(".listwrap tr.link").forEach((tr) => tr.classList.toggle("focus", tr.id === "row-" + id));
    drawDetail();
  }
  const rows = list.map((s) => {
    const r = sessionRows(s), lead = r.length && r[0].best ? r[0] : null;
    return { id: s.id, cells: [td(fmtDate(s.date), "b"), td(s.time, "c dim"), td(trackLabel(s.track, s.layout), "b"), td(s.type, "c dim"), weatherCell(s), td(s.entries.length, "c"),
      td(s.entries.reduce((a, e) => a + e.laps.length, 0), "c dim"), td(lead ? fmtTime(lead.best) : "-", "c " + (lead ? "purple b" : "dim")), td(lead ? nameOf(lead.pid) : "", "dim"), td(s.server, "dim")] };
  });
  root.append(bar, list.length ? listTable(["Date", "Time", "Track", "Type", "Weather", "Drivers", "Laps", "Fastest lap", "Driver", "Server"], rows, pick, st.sel) : noData("No sessions match."), detail);
  function rerender() { renderView(); }
  function drawDetail() {
    clear(detail);
    const s = list.find((x) => x.id === st.sel);
    if (s) detail.append(sessionDetail(s));
  }
  drawDetail();
  return root;
}

function recChip(sess) {
  const rec = trackRecord(sess);
  if (!rec) return null;
  const here = rec.sid === sess.id;
  return chip("Track record", `${nameOf(rec.pid)}  ${fmtTime(rec.best)}  ` + (here ? "(this session)" : `(${fmtDate(rec.date)})`), here ? cssVar("--purple") : undefined);
}

function sessionDetail(sess) {
  const rows = sessionRows(sess);
  const best = rows.length && rows[0].best ? rows[0] : null;
  const nl = sess.entries.reduce((a, e) => a + e.laps.length, 0), nv = sess.entries.reduce((a, e) => a + e.laps.filter((l) => l[4] && l[0] > 0).length, 0);
  const chips = h("div", { class: "chips" }, chip("Session", `${sess.type || "Session"}  ·  ${fmtDate(sess.date) || "-"} ${sess.time || ""}`.trim()), chip("Track", trackLabel(sess.track, sess.layout)),
    chip("Weather", sess.weather || "Not set"),
    best ? chip("Fastest lap", `${nameOf(best.pid)}  ${fmtTime(best.best)}`, cssVar("--purple")) : null,
    recChip(sess), chip("Drivers", sess.entries.length), chip("Laps", `${nv} valid of ${nl}`),
    sess.duration_min ? chip("Length", `${sess.duration_min} min`) : null);
  const tabs = tabset([
    { title: "Classification", make: () => tClass(rows) },
    { title: "Laps", make: () => tLaps(rows, sess) },
    { title: "Sectors / Ideal Lap", make: () => tSectors(rows) },
    { title: "Consistency", make: () => tCons(rows) },
    { title: "Lap times", make: () => h("div", null, pickerBar(outlierPicker(renderView)), lineBox(rows.map((r) => { const out = lapOutliers(r.e.laps, outlierPct()); return { label: nameOf(r.pid), color: colorOf(r.pid), gaps: [...out],
      pts: r.e.laps.map((l, i) => [i + 1, l[0], l]).filter(([n, , l]) => l[4] && l[0] > 0 && !out.has(n)).map(([x, y]) => [x, y]) }; }).filter((s) => s.pts.length), {},
      "Every valid lap, lap by lap. A lap further from the driver's median lap than the Show laps choice (in / out laps, spins) is left out and shows as a gap in the line.")) },
    { title: "Best lap progress", make: () => h("div", null, pickerBar(outlierPicker(renderView)), lineBox(rows.map((r) => { const out = lapOutliers(r.e.laps, outlierPct()); let run = 0; const pts = []; r.e.laps.forEach((l, i) => { if (l[4] && l[0] > 0 && !out.has(i + 1) && (!run || l[0] < run)) { run = l[0]; pts.push([i + 1, run]); } }); return { label: nameOf(r.pid), color: colorOf(r.pid), pts }; }).filter((s) => s.pts.length), {},
      "Each point is a lap that was a new best for that driver, joined by a line: the steps down show when they found time. Laps further from the driver's median lap than the Show laps choice are not counted.")) },
    { title: "Time found", make: () => tFound(rows) },
    { title: "Cuts / incidents", make: () => tIncidents(rows) },
  ], 0, "session");
  return h("div", { class: "session" }, chips, tabs.el);
}

function tFound(rows) {
  const out = [];
  rows.forEach((r) => {
    const v = r.e.laps.map((l, i) => [i + 1, l[0], l]).filter(([, , l]) => l[4] && l[0] > 0).map(([n, t]) => [n, t]);
    if (v.length < 2) return;
    const first = v[0][1], bl = v.reduce((a, b) => (b[1] < a[1] ? b : a));
    if (first > bl[1]) out.push({ name: nameOf(r.pid), color: colorOf(r.pid), found: first - bl[1], first, best: bl[1], lap: bl[0] });
  });
  out.sort((a, b) => b.found - a.found);
  const mx = out.length ? out[0].found : 1;
  const body = out.length ? out.map((o) => h("div", { class: "frow" }, h("span", { class: "fname", text: o.name }),
    h("span", { class: "ftrack" }, h("span", { class: "fbar", style: { width: Math.max(0.5, 100 * o.found / mx) + "%", background: o.color } })),
    h("span", { class: "fval", text: "-" + (o.found / 1000).toFixed(3) + " s   " + fmtTime(o.first) + " > " + fmtTime(o.best) + "  (lap " + o.lap + ")" }))) : [noData("No driver has two valid laps yet")];
  return h("div", { class: "chartwrap" }, h("div", { class: "found" }, body),
    h("div", { class: "hint", text: "How much faster each driver's best lap is than their first valid lap: a long bar means a lot of time found during the session. Drivers whose first valid lap was their best are not shown." }));
}

function tClass(rows) {
  const trs = rows.map((r) => {
    const st = r.st;
    return h("tr", null, td(r.pos || "-", "c b " + medalClass(r.pos)), td(nameOf(r.pid), "b"), td(r.car, "dim"), td(r.num || "", "c dim"),
      td(r.best ? fmtTime(r.best) : "no valid lap", "r " + (r.pos === 1 ? "purple b" : r.best ? "" : "dim")), td(r.gap ? fmtGap(r.gap) : "", "r dim"), td(r.interval ? fmtGap(r.interval) : "", "r dim"),
      td(st.ideal ? fmtTime(st.ideal) : "", "r dim"), td(st.laps, "c"), td(st.valid, "c dim"), td(st.cons ? st.cons.toFixed(1) : "", "c dim"));
  });
  return table(["Pos", "Driver", "Car", "No.", "Best lap", "Gap", "Interval", "Ideal lap", "Laps", "Valid", "Consistency"], trs, "", [
    "Position by best valid lap", "Driver", "Car", "Race number", "The fastest lap the game counted", "Behind the fastest lap of the session", "Behind the driver ranked just above",
    "The best sectors of all their valid laps added together", "Laps driven", "Laps the game counted (no cut)", "Out of 100: how steady the valid laps are (see the Consistency tab)"]);
}

function trackRecord(sess) {
  const b = statsBoard(allSessions(), trackKey(sess.track, sess.layout));
  return b.length && b[0].best ? b[0] : null;
}

function tLaps(rows, sess) {
  const have = rows.filter((r) => r.e.laps.length);
  const nl = Math.max(0, ...have.map((r) => r.e.laps.length));
  const sbest = Math.min(...have.map((r) => r.best).filter((b) => b > 0), Infinity);
  const rec = trackRecord(sess), recHere = !!(rec && rec.sid === sess.id);
  let flip = false;
  try { flip = localStorage.getItem("laps_flip") === "1"; } catch (e) { /* storage blocked */ }
  const box = h("div");
  const cell = (r, i) => {
    const l = r.e.laps[i];
    if (!l) return td("");
    const ok = !!(l[4] && l[0] > 0);
    return lapTd(l[0], { best: ok && l[0] === sbest, mine: ok && l[0] === r.best, invalid: !ok, star: ok && recHere && r.pid === rec.pid && l[0] === rec.best });
  };
  const draw = () => {
    clear(box);
    const btn = h("button", { class: "btn", type: "button", title: "Swap the table: drivers down the side with the laps across, or the other way round",
      text: flip ? "Flip: laps down the side" : "Flip: drivers down the side",
      onclick: () => { flip = !flip; try { localStorage.setItem("laps_flip", flip ? "1" : "0"); } catch (e) { /* storage blocked */ } draw(); } });
    const lapNums = Array.from({ length: nl }, (_, i) => i);
    const tbl = flip
      ? table(["Driver", ...lapNums.map((i) => String(i + 1))], have.map((r) => h("tr", null, td(nameOf(r.pid), "b"), lapNums.map((i) => cell(r, i)))), "laps")
      : table(["Lap", ...have.map((r) => nameOf(r.pid))], lapNums.map((i) => h("tr", null, td(i + 1, "c dim"), have.map((r) => cell(r, i)))), "laps");
    box.append(h("div", { class: "toolbar" }, btn), tbl,
      h("div", { class: "hint", text: "Purple = the session's fastest lap  ·  green = the driver's own best  ·  red italic = a lap the game did not count (track cut / invalid)" + (recHere ? "  ·  \u2605 = the track record" : "") }));
  };
  draw();
  return box;
}

function tSectors(rows) {
  const have = rows.filter((r) => r.best);
  const sb = [0, 1, 2].map((k) => Math.min(...have.map((r) => r.st.sectors[k]).filter((x) => x), Infinity));
  const ideals = have.map((r) => r.st.ideal).filter((x) => x).sort((a, b) => a - b);
  const trs = have.map((r) => {
    const st = r.st;
    return h("tr", null, td(nameOf(r.pid), "b"), [0, 1, 2].map((k) => td(fmtTime(st.sectors[k]), "r " + pc(st.sectors[k] && st.sectors[k] === sb[k], "purple b"))),
      td(st.ideal ? fmtTime(st.ideal) : "", "r " + pc(st.ideal && st.ideal === ideals[0], "green b")), td(fmtTime(r.best), "r"),
      td(st.ideal && r.best > st.ideal ? fmtGap(r.best - st.ideal) : "", "r dim"));
  });
  return h("div", null, table(["Driver", "Best S1", "Best S2", "Best S3", "Ideal lap", "Best lap", "Potential gain"], trs),
    h("div", { class: "hint", text: "Ideal lap = the best sector 1, 2 and 3 of the driver's valid laps added together  ·  Potential gain = how much faster the best lap could be  ·  purple = the quickest sector of the session" }));
}

function tCons(rows) {
  const have = rows.filter((r) => r.st.cons).sort((a, b) => b.st.cons - a.st.cons);
  const trs = have.map((r, i) => h("tr", null, td(i + 1, "c b " + medalClass(i + 1)), td(nameOf(r.pid), "b"), td(r.st.cons.toFixed(1), "c " + pc(i === 0, "green b")),
    td(fmtTime(r.st.avg), "r"), td((r.st.sd / 1000).toFixed(3) + " s", "r dim"), td(r.st.counted, "c dim"), td(r.st.valid, "c dim")));
  return table(["Rank", "Driver", "Consistency", "Average lap", "Std. deviation", "Laps counted", "Valid laps"], trs, "", [
    "Rank", "Driver",
    "Out of 100: 100 minus 10 x the standard deviation as a % of the average lap. Counts valid laps within 8% of the driver's best lap (needs 3 valid laps). Laps the game did not count (cuts) are left out; slow laps and mistakes lower it.",
    "Average of the counted laps", "How far the counted laps spread from the average, in seconds. Bigger = less steady", "Valid laps within 8% of the driver's best lap", "Laps the game counted"]);
}

function tIncidents(rows) {
  const trs = rows.map((r) => {
    const e = r.e, bad = e.laps.map((l, i) => (l[4] && l[0] > 0 ? 0 : i + 1)).filter(Boolean);
    const cuts = e.pens.filter((p) => p[0] === "cut").length, spd = e.pens.filter((p) => p[0] === "pit speeding").length;
    return h("tr", null, td(nameOf(r.pid), "b"), td(bad.length, "c " + (bad.length ? "bad" : "dim")), td(bad.join(", "), "dim"), td(cuts || "", "c " + (cuts ? "bad" : "dim")),
      td(spd || "", "c " + (spd ? "bad" : "dim")), td(e.hits[0] || "", "c dim"), td(e.hits[1] || "", "c dim"));
  });
  return table(["Driver", "Invalid laps", "Invalid lap numbers", "Track cut warnings", "Pit speeding", "Collisions", "With cars"], trs);
}

/* ---------------------------------------------------------------- tracks */
const mapSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
function findMap(track, layout) {
  const t = mapSlug(track), l = mapSlug(layout);
  const mine = (S.maps || []).filter((m) => { const c = mapSlug(m.circuit); return c && (t.includes(c) || c.includes(t)); });
  if (!t || !mine.length) return null;
  let exact = l ? mine.find((m) => mapSlug(m.layout) === l) : null;
  if (!exact && (l.startsWith("gp") || l.startsWith("innerloop"))) exact = mine.find((m) => mapSlug(m.layout) === "gp") || null;     // e.g. "GP Inner Loop" = the full circuit
  if (exact || (l && !["gp", "grandprix", "full", "f1", "default"].includes(l))) return exact || null;
  return mine.find((m) => ["gp", "full", ""].includes(mapSlug(m.layout))) || mine[0];
}
function viewTracks() {
  const root = h("div", { class: "page" });
  const st = P.tracks, ss0 = sortedSessions(allSessions()), ss = ss0;
  const tracks = statsTracks(ss);
  if (!tracks.some((t) => t.tkey === st.sel)) st.sel = tracks.length ? tracks[0].tkey : "";
  const detail = h("div");
  tracks.sort((a, b) => lc(trackLabel(a.track, a.layout)).localeCompare(lc(trackLabel(b.track, b.layout))));
  if (!tracks.length) { root.append(noData("No sessions yet.")); return root; }
  function drawDetail() {
    clear(detail);
    const x = tracks.find((t) => t.tkey === st.sel);
    if (!x) return;
    if (st.car && !x.cars.includes(st.car)) st.car = "";
    const car = st.car || null, since = periodSince(PERIODS[st.period][1]);
    const sw = ss0.filter((s) => weatherOk(s, st.weather));
    const board = statsBoard(sw, x.tkey, car, since).filter((r) => r.best);
    const here = sw.filter((s) => trackKey(s.track, s.layout) === x.tkey && (!since || s.date >= since) && (!car || s.entries.some((e) => e.car === car)));
    const bar = pickerBar(selectOf("Track:", st.sel, tracks.map((t) => [t.tkey, `${trackLabel(t.track, t.layout)}  (${t.sessions} session${t.sessions === 1 ? "" : "s"})`]), (v) => { st.sel = v; st.car = ""; drawDetail(); }),
      selectOf("Car:", st.car, [["", "All cars"], ...x.cars.map((c) => [c, c])], (v) => { st.car = v; drawDetail(); }),
      selectOf("Period:", st.period, PERIODS.map(([t], i) => [i, t]), (v) => { st.period = +v; drawDetail(); }),
      selectOf("Weather:", st.weather, WEATHERS, (v) => { st.weather = v; drawDetail(); }), h("span", { class: "grow" }),
      csvButton(() => visibleTable(detail), () => `${x.track}_${x.layout}_leaderboard`));
    const top = board[0];
    const mp = findMap(x.track, x.layout);
    const chips = h("div", { class: "chips" }, top ? chip("Record", fmtTime(top.best), cssVar("--purple")) : null, top ? chip("Held by", nameOf(top.pid)) : null,
      top ? chip("Set on", fmtDate(top.date)) : null, top ? chip("Car", top.car) : null, chip("Sessions", here.length), chip("Drivers", board.length),
      chip("Laps", `${board.reduce((a, r) => a + r.valid, 0)} valid of ${board.reduce((a, r) => a + r.laps, 0)}`));
    const topRow = h("div", { class: "toprow" }, chips, mp ? h("figure", { class: "trackmap" }, h("img", { src: "data/" + mp.file, alt: "Map of " + trackLabel(x.track, x.layout) }),
      h("figcaption", { text: `Map: ${mp.author}, ${mp.licence} (Wikimedia Commons)` })) : null);
    const tabs = tabset([
      { title: "Leaderboard", make: () => table(["Pos", "Driver", "Best lap", "Gap", "Ideal lap", "Sessions", "Laps", "Valid", "Car", "Date"],
        board.map((r) => h("tr", rowLink(r.sid), td(r.pos, "c b " + medalClass(r.pos)), td(nameOf(r.pid), "b"), td(fmtTime(r.best), "r " + pc(r.pos === 1, "purple b")), td(r.gap ? fmtGap(r.gap) : "", "r dim"),
          td(r.ideal ? fmtTime(r.ideal) : "", "r dim"), td(r.sessions, "c"), td(r.laps, "c dim"), td(r.valid, "c dim"), td(r.car, "dim"), td(fmtDate(r.date), "c dim"))), "",
        [null, null, null, null, "The driver's best sector 1, 2 and 3 (from any session here) added together"]) },
      { title: "Record history", make: () => {
        const pts = statsHistory(sw, x.tkey, car).filter((p) => !since || p.date >= since);
        if (!pts.length) return noData("No laps for this choice (try another car or period).");
        let low = 0; const run = [], rec = [], xl = {}, links = {};
        pts.forEach((p, i) => { low = !low || p.best < low ? p.best : low; run.push([i + 1, p.best]); rec.push([i + 1, low]); xl[i + 1] = fmtDate(p.date); links[i + 1] = p.sid; });
        return lineBox([{ label: "Fastest lap of the session", color: DRIVER_COLORS[1], pts: run }, { label: "Track record", color: DRIVER_COLORS[0], pts: rec }], { xlabels: xl, links },
          "Left to right = the sessions at this track, oldest first (labelled with their date). Blue = the fastest valid lap of each session  ·  red = the track record so far." + CLICK_HINT);
      } },
      { title: "Best sectors", make: () => {
        const cols = [0, 1, 2].map((k) => board.filter((r) => r.sectors[k]).map((r) => [r.sectors[k], r.pid]).sort((a, b) => cmpT([a[0], a[1]], [b[0], b[1]])));
        const trs = cols.map((c, k) => h("tr", null, td(`Sector ${k + 1}`, "b"), td(c.length ? fmtTime(c[0][0]) : "-", "r purple b"), td(c.length ? nameOf(c[0][1]) : "", "b"),
          td(c.length > 1 ? fmtTime(c[1][0]) : "-", "r dim"), td(c.length > 1 ? nameOf(c[1][1]) : "", "dim")));
        const ideal = cols.every((c) => c.length) ? cols.reduce((a, c) => a + c[0][0], 0) : 0;
        return h("div", null, table(["Sector", "Best time", "Driver", "Second best", "Driver"], trs),
          h("div", { class: "hint", text: "The quickest each sector has been driven here by anyone" + (ideal ? `  ·  all three together = ${fmtTime(ideal)}, the ideal lap for this track` : "") }));
      } },
      { title: "Sessions here", make: () => table(["Date", "Time", "Type", "Drivers", "Fastest lap", "Driver"], [...here].reverse().map((s) => {
        const r = sessionRows(s), lead = r.length && r[0].best ? r[0] : null;
        return h("tr", rowLink(s.id), td(fmtDate(s.date), "b"), td(s.time, "c dim"), td(s.type, "c dim"), td(s.entries.length, "c"), td(lead ? fmtTime(lead.best) : "-", "r " + (lead ? "purple b" : "dim")), td(lead ? nameOf(lead.pid) : "", "dim"));
      })) },
    ], 0, "track");
    detail.append(bar, topRow, tabs.el);
  }
  root.append(detail);
  drawDetail();
  return root;
}

/* ---------------------------------------------------------------- drivers */
function viewDrivers() {
  const root = h("div", { class: "page" });
  const st = P.drivers, ss = sortedSessions(allSessions());
  const rows = statsDrivers(ss).sort((a, b) => cmpT([-a.records, -a.sessions, lc(nameOf(a.pid))], [-b.records, -b.sessions, lc(nameOf(b.pid))]));
  if (!rows.some((r) => r.pid === st.sel)) st.sel = rows.length ? rows[0].pid : "";
  const detail = h("div");
  const list = rows.map((r) => ({ id: r.pid, cells: [td(nameOf(r.pid), "b"), td(r.sessions, "c"), td(r.laps, "c dim"), td(r.valid, "c dim"), td(r.tracks, "c"),
    td(r.records || "-", "c " + (r.records ? "purple b" : "dim")), td(fmtDate(r.first), "c dim"), td(fmtDate(r.last), "c dim")] }));
  root.append(rows.length ? listTable(["Driver", "Sessions", "Laps", "Valid laps", "Tracks", "Records held", "First session", "Last session"], list, (id) => { st.sel = id; pickRow(id); }, st.sel) : noData("No sessions yet."), detail);
  function pickRow(id) {
    root.querySelectorAll(".listwrap tr.link").forEach((tr) => tr.classList.toggle("focus", tr.id === "row-" + id));
    drawDetail();
  }
  function drawDetail() {
    clear(detail);
    const pid = st.sel, me = rows.find((r) => r.pid === pid);
    if (!me) return;
    const car = statsCareer(ss, pid);
    const chips = h("div", { class: "chips" }, chip("Driver", nameOf(pid)), chip("Sessions", me.sessions), chip("Laps", `${me.valid} valid of ${me.laps}`), chip("Tracks", me.tracks),
      chip("Records held", me.records || "-", me.records ? cssVar("--purple") : null));
    const tabs = tabset([
      { title: "Tracks", make: () => table(["Track", "Best lap", "Rank", "Track record", "Gap to record", "Ideal lap", "Sessions", "Laps", "Valid", "Car", "Date"], car.map((r) => h("tr", null,
        td(trackLabel(r.track, r.layout), "b"), td(r.best ? fmtTime(r.best) : "-", "r " + pc(r.pos === 1, "purple b")), td(r.pos ? `${r.pos} of ${r.of}` : "-", "c " + (r.pos && r.pos <= 3 ? "b " + medalClass(r.pos) : "")),
        td(r.record ? fmtTime(r.record) : "-", "r dim"), td(r.gap ? fmtGap(r.gap) : "", "r dim"), td(r.ideal ? fmtTime(r.ideal) : "", "r dim"), td(r.sessions, "c"), td(r.laps, "c dim"), td(r.valid, "c dim"),
        td(r.car, "dim"), td(fmtDate(r.date), "c dim")))) },
      { title: "Progress", make: () => {
        const wrap = h("div"), have = car.filter((r) => r.series.length);
        if (!have.length) return noData("No valid laps yet.");
        const holder = h("div");
        const sel = h("select", { "aria-label": "Track", onchange: () => draw() }, have.map((r) => option(r.tkey, trackLabel(r.track, r.layout))));
        function draw() {
          clear(holder);
          const r = have.find((x) => x.tkey === sel.value) || have[0];
          let low = 0; const pts = [], run = [], xl = {}, links = {};
          r.series.forEach((p, i) => { low = !low || p.best < low ? p.best : low; pts.push([i + 1, p.best]); run.push([i + 1, low]); xl[i + 1] = fmtDate(p.date); links[i + 1] = p.sid; });
          holder.append(lineBox([{ label: "Best lap of the session", color: DRIVER_COLORS[1], pts }, { label: "Best so far", color: DRIVER_COLORS[0], pts: run }], { xlabels: xl, links },
            "Blue = the driver's best lap of each session at this track, red = their best so far (their personal record coming down). Left to right = their sessions there, oldest first." + CLICK_HINT));
        }
        wrap.append(pickerBar(field("Track:", sel)), holder); draw();
        return wrap;
      } },
      { title: "Sessions", make: () => {
        const mine = [];
        for (const s of [...ss].reverse()) { const rr = sessionRows(s); const r = rr.find((x) => x.pid === pid); if (r) mine.push([s, r]); }
        return table(["Date", "Track", "Type", "Position", "Best lap", "Gap", "Laps", "Valid", "Consistency", "Car"], mine.map(([s, r]) => h("tr", rowLink(s.id), td(fmtDate(s.date), "b"), td(trackLabel(s.track, s.layout)), td(s.type, "c dim"),
          td(r.pos ? `${r.pos} of ${s.entries.length}` : "-", "c " + (r.pos && r.pos <= 3 ? medalClass(r.pos) : "dim")), td(r.best ? fmtTime(r.best) : "-", "r"), td(r.gap ? fmtGap(r.gap) : "", "r dim"),
          td(r.st.laps, "c dim"), td(r.st.valid, "c dim"), td(r.st.cons ? r.st.cons.toFixed(1) : "", "c dim"), td(r.car, "dim"))));
      } },
    ], 0, "driver");
    detail.append(pickerBar(h("span", { class: "grow" }), csvButton(() => visibleTable(detail), () => `${nameOf(pid)}_tracks`)), chips, tabs.el);
  }
  drawDetail();
  return root;
}

/* ---------------------------------------------------------------- head to head */
function viewH2h() {
  const root = h("div", { class: "page" });
  const st = P.h2h, ss = sortedSessions(allSessions());
  const drv = statsDrivers(ss), byName = [...drv].sort((a, b) => cmp(lc(nameOf(a.pid)), lc(nameOf(b.pid))));
  if (drv.length < 2) return h("div", { class: "page" }, noData("Head-to-head needs at least two drivers."));
  if (!drv.some((d) => d.pid === st.a)) st.a = drv[0].pid;
  if (!drv.some((d) => d.pid === st.b) || st.b === st.a) st.b = drv.find((d) => d.pid !== st.a).pid;
  const mk = (key) => { const sel = h("select", { "aria-label": "Driver " + key.toUpperCase(), onchange: () => { st[key] = sel.value; renderView(); } }, byName.map((d) => option(d.pid, nameOf(d.pid), d.pid === st[key]))); return sel; };
  const swap = h("button", { class: "btn sq", type: "button", title: "Swap the two drivers", "aria-label": "Swap", text: "⇄", onclick: () => { [st.a, st.b] = [st.b, st.a]; renderView(); } });
  const detail = h("div");
  root.append(pickerBar(field("A:", mk("a")), h("span", { class: "dim", text: "vs" }), field("B:", mk("b")), swap, h("span", { class: "grow" }),
    csvButton(() => visibleTable(detail), () => `${nameOf(st.a)}_vs_${nameOf(st.b)}`)), detail);
  const na = nameOf(st.a), nb = nameOf(st.b), [sa, sb] = shortNames(na, nb);
  const res = statsH2h(ss, st.a, st.b), s = res.summary;
  if (!res.tracks.length && !res.together.length) { detail.append(noData(`${na} and ${nb} have no track in common yet.`)); return root; }
  detail.append(h("div", { class: "chips" }, chip("Tracks in common", s.tracks), pairChip("Faster at track", s.a_tracks, s.b_tracks), chip("Sessions together", s.sessions), pairChip("Faster in session", s.a_sessions, s.b_sessions),
    s.avg_gap ? chip("Avg best-lap gap", `${s.avg_gap < 0 ? na : nb} by ${(Math.abs(s.avg_gap) / 1000).toFixed(3)}s`, s.avg_gap < 0 ? H2H_A : H2H_B) : null));
  const gapTd = (gap, aFast) => h("td", { class: "r", style: { color: gap ? (aFast ? H2H_A : H2H_B) : null }, text: gap ? (aFast ? "-" : "+") + (Math.abs(gap) / 1000).toFixed(3) : "" });
  const selTrack = { v: res.tracks.length ? res.tracks[0].tkey : "" }, selSess = { v: res.together.length ? res.together[res.together.length - 1].sid : "" };
  const trk = res.tracks.map((x) => ({ id: x.tkey, cells: [td(trackLabel(x.track, x.layout), "b"), td(fmtTime(x.a_best), "r " + pc(x.gap < 0, "purple b")), td(fmtTime(x.b_best), "r " + pc(x.gap > 0, "purple b")),
    gapTd(x.gap, x.gap < 0), td(x.a_ideal ? fmtTime(x.a_ideal) : "", "r dim"), td(x.b_ideal ? fmtTime(x.b_ideal) : "", "r dim"), td(x.a_sessions, "c"), td(x.b_sessions, "c"),
    h("td", { class: "c b", style: { color: x.gap ? (x.gap < 0 ? H2H_A : H2H_B) : null }, text: x.gap ? (x.gap < 0 ? na : nb) : "-" })] }));
  const tog = [...res.together].reverse().map((x) => {
    const both = x.a_best && x.b_best, af = both && x.gap < 0, bf = both && x.gap > 0;
    return { id: x.sid, cells: [td(fmtDate(x.date), "b"), td(trackLabel(x.track, x.layout)), td(x.type, "c dim"), td(fmtTime(x.a_best), "r " + pc(af, "purple b")), td(fmtTime(x.b_best), "r " + pc(bf, "purple b")),
      gapTd(both ? x.gap : 0, af), td(x.a_laps, "c dim"), td(x.b_laps, "c dim"), td(x.a_cons ? x.a_cons.toFixed(1) : "", "c dim"), td(x.b_cons ? x.b_cons.toFixed(1) : "", "c dim"),
      h("td", { class: "c b", style: { color: af ? H2H_A : bf ? H2H_B : null }, text: af ? na : bf ? nb : "-" })] };
  });
  const upper = tabset([
    { title: "Tracks", make: () => listTable(["Track", `${sa} best`, `${sb} best`, "Gap", `${sa} ideal`, `${sb} ideal`, `${sa} sessions`, `${sb} sessions`, "Faster"], trk, (id) => { selTrack.v = id; markRows(upper.el, id); drawLower(); }, selTrack.v) },
    { title: "Sessions together", make: () => tog.length ? listTable(["Date", "Track", "Type", `${sa} best`, `${sb} best`, "Gap", `${sa} laps`, `${sb} laps`, `${sa} consistency`, `${sb} consistency`, "Faster"], tog,
      (id) => { selSess.v = id; markRows(upper.el, id); drawLower(); }, selSess.v) : noData("They have not driven in the same session.") },
  ]);
  function markRows(el, id) { el.querySelectorAll(".pane:not([hidden]) tr.link").forEach((tr) => tr.classList.toggle("focus", tr.id === "row-" + id)); }
  const lowHolder = h("div");
  const makeLow = (start) => tabset([
    { title: "Lap times (selected session)", make: () => lowerLaps() },
    { title: "Best lap over time (selected track)", make: () => lowerProgress() },
    { title: "Sectors (selected track)", make: () => lowerSectors() },
  ], start);
  let low = makeLow(0);
  lowHolder.append(low.el);
  function lowerLaps() {
    const sess = ss.find((x) => x.id === selSess.v);
    if (!sess) return noData("Pick a session in the Sessions together tab.");
    const series = [[st.a, H2H_A], [st.b, H2H_B]].map(([pid, col]) => { const e = sess.entries.find((q) => q.pid === pid);
      const out = e ? lapOutliers(e.laps, outlierPct()) : new Set();
      return { label: nameOf(pid), color: col, gaps: [...out], pts: e ? e.laps.map((l, i) => [i + 1, l[0], l]).filter(([n, , l]) => l[4] && l[0] > 0 && !out.has(n)).map(([x, y]) => [x, y]) : [] }; }).filter((q) => q.pts.length);
    return h("div", null, pickerBar(outlierPicker(drawLower)),
      lineBox(series, {}, `Every valid lap of the session on ${fmtDate(sess.date)}. A lap further from the driver's median lap than the Show laps choice is left out and shows as a gap.`, 380));
  }
  function lowerProgress() {
    const here = ss.filter((x) => trackKey(x.track, x.layout) === selTrack.v), xl = {}, links = {};
    here.forEach((x, i) => { xl[i + 1] = fmtDate(x.date); links[i + 1] = x.id; });
    const series = [[st.a, H2H_A], [st.b, H2H_B]].map(([pid, col]) => { const pts = [];
      here.forEach((x, i) => { const e = x.entries.find((q) => q.pid === pid); const l = e ? lapStats(e.laps) : null; if (l && l.best) pts.push([i + 1, l.best]); });
      return { label: nameOf(pid), color: col, pts }; }).filter((q) => q.pts.length);
    return lineBox(series, { xlabels: xl, links }, "The best lap of each session at the track, oldest first (labelled with the date)." + CLICK_HINT, 380);
  }
  function lowerSectors() {
    const x = res.tracks.find((t) => t.tkey === selTrack.v);
    if (!x) return noData("Pick a track in the Tracks tab.");
    const trs = [0, 1, 2, 3].map((k) => {
      const av = k < 3 ? x.a_sectors[k] : x.a_ideal, bv = k < 3 ? x.b_sectors[k] : x.b_ideal, gap = av && bv ? av - bv : 0;
      return h("tr", null, td(k < 3 ? `Sector ${k + 1}` : "Ideal lap", "b"), td(av ? fmtTime(av) : "-", "r " + pc(gap < 0, "purple b")), td(bv ? fmtTime(bv) : "-", "r " + pc(gap > 0, "purple b")), gapTd(gap, gap < 0),
        h("td", { class: "c b", style: { color: gap ? (gap < 0 ? H2H_A : H2H_B) : null }, text: gap ? (gap < 0 ? na : nb) : "-" }));
    });
    return table(["Sector", `${sa} best`, `${sb} best`, "Gap", "Faster"], trs);
  }
  function drawLower() { const i = Math.max(0, low.index); clear(lowHolder); low = makeLow(i); lowHolder.append(low.el); }
  detail.append(upper.el, lowHolder);
  return root;
}
