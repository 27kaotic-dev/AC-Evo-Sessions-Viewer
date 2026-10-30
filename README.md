# ACE Sessions Viewer

A read-only viewer for AC EVO practice, qualifying and race sessions: sessions, tracks, drivers and head to head.

- **Live data:** the page reads `data/index.json` and the session files it lists. The desktop program writes both
  (File > Publish web data…).
- **Without the program:** use *Open files…* or drop AC EVO session result `.json` files on the page. They are read in your
  browser only; nothing is uploaded.
- **Hosting:** put this folder on GitHub Pages (or any static web server). There is nothing to build.

| File | What it does |
|---|---|
| `index.html` | the page |
| `js/core.js` | reads a result file and works out the statistics (same numbers as the desktop program) |
| `js/pages.js` | Sessions, Tracks, Drivers and Head-to-head |
| `js/app.js` | the page frame, theme, loading and opening files |
| `js/chart.js`, `js/ui.js`, `js/util.js`, `css/` | charts, tables and styling |
| `data/` | what the desktop program publishes (empty until you publish) |

A lap counts when the game counts it (no track cut). Drivers are matched by Steam ID.
