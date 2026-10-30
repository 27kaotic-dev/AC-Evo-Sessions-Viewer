"use strict";
/* The session data and the numbers: reading a result file, and the statistics.  A port of the desktop program's
   "ACE Practice Laps.py", so both show the same figures.  A lap is [time, s1, s2, s3, valid]. */

const LAP_VALID = 2;            // the game counts a lap towards the best lap when this flag is set
const CONS_WINDOW = 1.08;       // a lap counts for consistency when it is valid and within 8% of the driver's best lap
const CONS_SCALE = 10;          // consistency = 100 - 10 x (standard deviation as a % of the average lap)
const FORMAT = 1;
const INVESTIGATION = { InvestigationType_Racecar_Cut: "cut", InvestigationType_Speeding: "pit speeding",
  InvestigationType_Wrong_Way: "wrong way", InvestigationType_Wrong_Position_On_Start: "start position" };

/* ---------------------------------------------------------------- small helpers */
const gid = (k) => (k && typeof k === "object" ? `${k.a ?? ""}.${k.b ?? ""}` : String(k));
const safeNum = (v, d = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };
const lc = (s) => String(s).toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpT = (a, b) => { for (let i = 0; i < a.length; i++) { const c = cmp(a[i], b[i]); if (c) return c; } return 0; };

function fileStamp(name) {
  const m = String(name || "").split(/[\\/]/).pop().match(/(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})_(\d{2})/);
  return m ? [m[1], `${m[2]}:${m[3]}:${m[4]}`] : ["", ""];
}
function trackKey(track, layout) { return (String(track || "").trim().toLowerCase() + "|" + String(layout || "").trim().toLowerCase()).replace(/^\|+|\|+$/g, ""); }
function trackLabel(track, layout) {
  track = String(track || "").trim(); layout = String(layout || "").trim();
  return layout ? `${track} (${layout})` : track;
}
function sessionCmp(a, b) { return cmpT([a.date || "", a.time || "", a.id || ""], [b.date || "", b.time || "", b.id || ""]); }
const sortedSessions = (ss) => [...ss].sort(sessionCmp);

/* sha1 of an ASCII string -> hex (the session id has to be the same here and in the desktop program) */
function sha1Hex(str) {
  const bytes = []; for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  const l = bytes.length; bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor((l * 8) / 4294967296), lo = (l * 8) >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let o = 0; o < bytes.length; o += 64) {
    const w = new Array(80);
    for (let i = 0; i < 16; i++) w[i] = ((bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; } else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rol(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}
/* what Python's json.dumps(..., separators=(",", ":")) writes: non-ASCII characters as \uXXXX */
const pyJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/* ---------------------------------------------------------------- reading a result file */
function isSessionFile(root) {
  return !!root && typeof root === "object" && Array.isArray(root.laps) && Array.isArray(root.drivers) && "track_name" in root;
}

function parseSession(root, source, lastModified) {
  const people = new Map();
  for (const d of root.drivers || []) {
    const g = gid(d.guid);
    if (people.has(g)) continue;                              // the game can list a driver twice
    const first = String(d.first_name || "").trim(), last = String(d.last_name || "").trim(), nick = String(d.nickname || "").trim();
    const steam = String(d.player_id || "").trim();
    people.set(g, { pid: steam ? "s:" + steam : "g:" + g, name: `${first} ${last}`.trim() || nick || "Unknown", nick, nation: String(d.nation || "") });
  }
  const cars = new Map((root.cars || []).map((c) => [gid(c.car_id), c]));
  const km = new Map((root.car_standings || []).map((c) => [gid(c.car_id), c.total_km || 0]));
  const entries = new Map(), order = [];
  for (const l of root.laps || []) {
    const dk = gid(l.driver_key), ck = gid(l.car_key), t = safeNum(l.time);
    const sp = (l.split || []).map((x) => safeNum(x)).slice(0, 3); while (sp.length < 3) sp.push(0);
    const ok = (safeNum(l.flags) & LAP_VALID) && t > 0 ? 1 : 0;
    if (!people.has(dk)) people.set(dk, { pid: "g:" + dk, name: "Unknown", nick: "", nation: "" });
    const key = dk + "|" + ck;
    if (!entries.has(key)) {
      const c = cars.get(ck) || {};
      entries.set(key, { pid: people.get(dk).pid, car: String(c.model_displayname || ""), num: safeNum(c.race_number), laps: [], pens: [], hits: [0, 0],
        km: Math.round(Number(km.get(ck) || 0) * 10) / 10, _ck: ck });
      order.push(key);
    }
    entries.get(key).laps.push([t, ...sp, ok]);
  }
  const byCar = new Map();
  for (const key of order) { const e = entries.get(key); if (!byCar.has(e._ck)) byCar.set(e._ck, []); byCar.get(e._ck).push(e); }
  for (const sp of ((root.penalty_collection || {}).session_penalties) || []) {
    for (const e of byCar.get(gid(sp.car_id)) || []) {
      for (const k of ["pending_penalties", "cleared_penalties"]) {
        for (const p of sp[k] || []) {
          const inv = p.investigation;
          e.pens.push([INVESTIGATION[inv] || String(inv || "").split("_").slice(1).join("_").toLowerCase(), safeNum(p.given_lap_count)]);
        }
      }
    }
  }
  for (const c of root.collisions || []) {
    for (const e of byCar.get(gid(c.car_id)) || []) {
      e.hits[0] += 1;
      if (String(c.collider || "Object") !== "Object") e.hits[1] += 1;
    }
  }
  let [date, clock] = fileStamp(source);
  if (!date && lastModified) date = new Date(lastModified).toISOString().slice(0, 10);
  const base = ((root.specialization || {}).base) || {};
  const outEntries = order.map((k) => { const e = entries.get(k); const o = {}; for (const f of ["pid", "car", "num", "laps", "pens", "hits", "km"]) o[f] = e[f]; return o; });
  const used = new Set(outEntries.map((e) => e.pid));
  const drivers = {};
  for (const p of people.values()) if (used.has(p.pid)) drivers[p.pid] = { name: p.name, nick: p.nick, nation: p.nation };
  const sess = { v: FORMAT, source: String(source || "").split(/[\\/]/).pop(), imported: new Date().toISOString().slice(0, 19),
    server: String(root.server_name || ""), type: String(root.session_type || ""), track: String(root.track_name || ""), layout: String(root.track_layout_name || ""),
    date, time: clock, duration_min: Math.round(safeNum(base.session_duration_ms) / 6000) / 10, drivers, entries: outEntries };
  const forId = [sess.track, sess.layout, sess.type, sess.date, sess.time, outEntries.map((e) => [e.pid, e.car, e.laps]).sort((a, b) => cmpT([a[0], a[1], pyJson(a[2])], [b[0], b[1], pyJson(b[2])]))];
  sess.id = sha1Hex(pyJson(forId)).slice(0, 12);
  return sess;
}

/* ---------------------------------------------------------------- the numbers */
function lapStats(laps) {
  const valid = laps.filter((l) => l[4] && l[0] > 0);
  const out = { laps: laps.length, valid: valid.length, best: 0, best_lap: 0, sectors: [0, 0, 0], ideal: 0, avg: 0, sd: 0, cons: 0, counted: 0 };
  if (!valid.length) return out;
  const best = Math.min(...valid.map((l) => l[0]));
  out.best = best;
  out.best_lap = laps.findIndex((l) => l[4] && l[0] === best) + 1;
  for (let k = 0; k < 3; k++) { const v = valid.map((l) => l[1 + k]).filter((x) => x > 0); out.sectors[k] = v.length ? Math.min(...v) : 0; }
  if (out.sectors.every((x) => x)) out.ideal = out.sectors.reduce((a, b) => a + b, 0);
  const good = valid.map((l) => l[0]).filter((t) => t <= best * CONS_WINDOW);
  out.counted = good.length;
  if (valid.length >= 3 && good.length >= 2) {
    const avg = good.reduce((a, b) => a + b, 0) / good.length;
    const sd = Math.sqrt(good.reduce((a, t) => a + (t - avg) ** 2, 0) / (good.length - 1));
    out.avg = avg; out.sd = sd; out.cons = Math.max(0, 100 - CONS_SCALE * (sd / avg * 100));
  }
  return out;
}

function sessionRows(sess) {
  const rows = sess.entries.map((e) => { const st = lapStats(e.laps); return { e, pid: e.pid, car: e.car, num: e.num, st, best: st.best }; });
  rows.sort((a, b) => cmpT([a.best ? 0 : 1, a.best, a.pid], [b.best ? 0 : 1, b.best, b.pid]));
  const lead = rows.length && rows[0].best ? rows[0].best : 0;
  let prev = 0;
  rows.forEach((r, i) => {
    r.pos = r.best ? i + 1 : null;
    r.gap = r.best && i ? r.best - lead : 0;
    r.interval = r.best && i && prev ? r.best - prev : 0;
    if (r.best) prev = r.best;
  });
  return rows;
}

function displayName(drv, style) {
  const full = drv.name || "Unknown", nick = drv.nick || "";
  if (style === "nick") return nick || full;
  if (style === "both" && nick && lc(nick) !== lc(full)) return `${full} (${nick})`;
  return full;
}

function driverNames(sessions, style) {
  const out = {};
  for (const s of sortedSessions(sessions)) for (const [pid, d] of Object.entries(s.drivers)) out[pid] = displayName(d, style);
  return out;
}

function statsTracks(sessions) {
  const t = new Map();
  for (const s of sessions) {
    const k = trackKey(s.track, s.layout);
    if (!t.has(k)) t.set(k, { tkey: k, track: s.track, layout: s.layout, sessions: 0, laps: 0, valid: 0, _d: new Set(), _c: new Set(), first: "", last: "" });
    const x = t.get(k);
    x.sessions += 1;
    for (const e of s.entries) {
      x._d.add(e.pid); x._c.add(e.car); x.laps += e.laps.length; x.valid += e.laps.filter((l) => l[4] && l[0] > 0).length;
    }
    if (s.date && (!x.first || s.date < x.first)) x.first = s.date;
    if (s.date && s.date > x.last) x.last = s.date;
  }
  const out = [...t.values()].map((x) => { x.drivers = x._d.size; x.cars = [...x._c].filter(Boolean).sort(); delete x._d; delete x._c; return x; });
  out.sort((a, b) => cmpT([-a.sessions, lc(a.track), lc(a.layout)], [-b.sessions, lc(b.track), lc(b.layout)]));
  return out;
}

function statsBoard(sessions, tkey, car, since) {
  const d = new Map();
  for (const s of sessions) {
    if (trackKey(s.track, s.layout) !== tkey || (since && (s.date || "") < since)) continue;
    for (const e of s.entries) {
      if (car && e.car !== car) continue;
      const st = lapStats(e.laps);
      if (!d.has(e.pid)) d.set(e.pid, { pid: e.pid, best: 0, sid: "", date: "", car: "", sessions: 0, laps: 0, valid: 0, sectors: [0, 0, 0], _s: new Set() });
      const r = d.get(e.pid);
      r.laps += st.laps; r.valid += st.valid; r._s.add(s.id);
      for (let k = 0; k < 3; k++) if (st.sectors[k] && (!r.sectors[k] || st.sectors[k] < r.sectors[k])) r.sectors[k] = st.sectors[k];
      if (st.best && (!r.best || st.best < r.best || (st.best === r.best && (s.date || "") < r.date))) { r.best = st.best; r.sid = s.id; r.date = s.date; r.car = e.car; }
    }
  }
  const rows = [...d.values()].map((r) => { r.sessions = r._s.size; delete r._s; r.ideal = r.sectors.every((x) => x) ? r.sectors.reduce((a, b) => a + b, 0) : 0; return r; });
  rows.sort((a, b) => cmpT([a.best ? 0 : 1, a.best, a.date, a.pid], [b.best ? 0 : 1, b.best, b.date, b.pid]));
  const lead = rows.length && rows[0].best ? rows[0].best : 0;
  rows.forEach((r, i) => { r.pos = r.best ? i + 1 : null; r.gap = r.best && i ? r.best - lead : 0; });
  return rows;
}

function statsHistory(sessions, tkey, car) {
  const pts = [];
  let rec = 0;
  for (const s of sortedSessions(sessions)) {
    if (trackKey(s.track, s.layout) !== tkey) continue;
    let best = null;
    for (const e of s.entries) {
      if (car && e.car !== car) continue;
      const st = lapStats(e.laps);
      if (st.best && (best === null || st.best < best.best)) best = { best: st.best, pid: e.pid, car: e.car };
    }
    if (best) {
      pts.push({ sid: s.id, date: s.date, time: s.time, best: best.best, pid: best.pid, car: best.car, record: !rec || best.best < rec });
      if (!rec || best.best < rec) rec = best.best;
    }
  }
  return pts;
}

function statsDrivers(sessions) {
  const d = new Map();
  for (const s of sessions) {
    for (const e of s.entries) {
      if (!d.has(e.pid)) d.set(e.pid, { pid: e.pid, _s: new Set(), laps: 0, valid: 0, _t: new Set(), first: "", last: "" });
      const x = d.get(e.pid);
      x._s.add(s.id); x.laps += e.laps.length; x.valid += e.laps.filter((l) => l[4] && l[0] > 0).length; x._t.add(trackKey(s.track, s.layout));
      if (s.date && (!x.first || s.date < x.first)) x.first = s.date;
      if (s.date && s.date > x.last) x.last = s.date;
    }
  }
  const records = new Map();
  for (const k of new Set(sessions.map((s) => trackKey(s.track, s.layout)))) {
    const b = statsBoard(sessions, k);
    if (b.length && b[0].best) records.set(b[0].pid, (records.get(b[0].pid) || 0) + 1);
  }
  const out = [...d.values()].map((x) => { x.sessions = x._s.size; x.tracks = x._t.size; delete x._s; delete x._t; x.records = records.get(x.pid) || 0; return x; });
  out.sort((a, b) => cmpT([-a.records, -a.sessions, a.pid], [-b.records, -b.sessions, b.pid]));
  return out;
}

function statsCareer(sessions, pid) {
  const tracks = new Map();
  for (const s of sortedSessions(sessions)) {
    const k = trackKey(s.track, s.layout);
    for (const e of s.entries) {
      if (e.pid !== pid) continue;
      const st = lapStats(e.laps);
      if (!tracks.has(k)) tracks.set(k, { tkey: k, track: s.track, layout: s.layout, sessions: 0, laps: 0, valid: 0, series: [] });
      const t = tracks.get(k);
      t.sessions += 1; t.laps += st.laps; t.valid += st.valid;
      if (st.best) t.series.push({ sid: s.id, date: s.date, best: st.best, car: e.car, cons: st.cons, ideal: st.ideal });
    }
  }
  const rows = [];
  for (const [k, t] of tracks) {
    const b = statsBoard(sessions, k);
    const mine = b.find((r) => r.pid === pid) || null;
    t.best = mine ? mine.best : 0; t.pos = mine ? mine.pos : null; t.of = b.filter((r) => r.best).length;
    t.record = b.length && b[0].best ? b[0].best : 0; t.gap = mine ? mine.gap : 0; t.date = mine ? mine.date : "";
    t.car = mine ? mine.car : ""; t.ideal = mine ? mine.ideal : 0;
    rows.push(t);
  }
  rows.sort((a, b) => cmpT([-a.sessions, lc(a.track)], [-b.sessions, lc(b.track)]));
  return rows;
}

function statsH2h(sessions, a, b) {
  const ca = new Map(statsCareer(sessions, a).map((t) => [t.tkey, t])), cb = new Map(statsCareer(sessions, b).map((t) => [t.tkey, t]));
  const tracks = [];
  for (const [k, ta] of ca) {
    const tb = cb.get(k);
    if (!tb || !ta.best || !tb.best) continue;
    const board = statsBoard(sessions, k);
    const ra = board.find((r) => r.pid === a), rb = board.find((r) => r.pid === b);
    tracks.push({ tkey: k, track: ta.track, layout: ta.layout, a_best: ra.best, b_best: rb.best, gap: ra.best - rb.best, a_ideal: ra.ideal, b_ideal: rb.ideal,
      a_sectors: ra.sectors, b_sectors: rb.sectors, a_sessions: ta.sessions, b_sessions: tb.sessions, a_pos: ra.pos, b_pos: rb.pos });
  }
  tracks.sort((x, y) => cmpT([-(x.a_sessions + x.b_sessions), lc(x.track)], [-(y.a_sessions + y.b_sessions), lc(y.track)]));
  const together = [];
  for (const s of sortedSessions(sessions)) {
    const ea = s.entries.filter((e) => e.pid === a), eb = s.entries.filter((e) => e.pid === b);
    if (!ea.length || !eb.length) continue;
    const sa = lapStats(ea[0].laps), sb = lapStats(eb[0].laps);
    together.push({ sid: s.id, date: s.date, time: s.time, track: s.track, layout: s.layout, type: s.type, a_best: sa.best, b_best: sb.best,
      gap: sa.best && sb.best ? sa.best - sb.best : 0, a_laps: sa.valid, b_laps: sb.valid, a_cons: sa.cons, b_cons: sb.cons, a_avg: sa.avg, b_avg: sb.avg });
  }
  const both = together.filter((t) => t.a_best && t.b_best);
  const summary = { tracks: tracks.length, a_tracks: tracks.filter((t) => t.gap < 0).length, b_tracks: tracks.filter((t) => t.gap > 0).length,
    sessions: together.length, a_sessions: both.filter((t) => t.gap < 0).length, b_sessions: both.filter((t) => t.gap > 0).length,
    avg_gap: both.length ? both.reduce((x, t) => x + t.gap, 0) / both.length : 0 };
  return { tracks, together, summary };
}

const PERIODS = [["All time", null], ["Last 30 days", 30], ["Last 3 months", 91], ["Last 6 months", 182], ["Last year", 365]];
function periodSince(days, today) {
  if (!days) return null;
  const d = today ? new Date(today) : new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
