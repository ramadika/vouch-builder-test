// Page shell + CSS for the handover. generateHandover() returns the grounded
// inner fragment; this wraps it in a readable, colour-coded full page.

import type { HotelMeta } from "./types.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Small pipeline summary shown in the footer, for at-a-glance trust/debug. */
export interface RenderStats {
  jsonEventCount: number;
  parsedEventCount: number;
  threadCount: number;
  flagCount: number;
}

const STYLES = `
  :root {
    --fire: #c0392b; --pending: #b9770e; --fyi: #555; --resolved: #1e7e34;
    --flag-bg: #fff4e5; --flag-border: #e67e22; --ink: #1a1a1a; --muted: #888;
  }
  * { box-sizing: border-box; }
  body {
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); margin: 0; background: #f6f6f4;
  }
  .wrap { max-width: 820px; margin: 0 auto; padding: 28px 20px 60px; }
  header { border-bottom: 2px solid #e0e0dc; padding-bottom: 14px; margin-bottom: 8px; }
  header h1 { font-size: 22px; margin: 0 0 4px; }
  header .meta { color: var(--muted); font-size: 14px; }
  section { background: #fff; border: 1px solid #e6e6e2; border-radius: 10px;
            padding: 6px 18px 14px; margin: 18px 0; }
  h2 { font-size: 17px; margin: 14px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
  h2.fire { color: var(--fire); }
  h2.pending { color: var(--pending); }
  h2.fyi { color: var(--fyi); }
  h2.resolved { color: var(--resolved); }
  ul { list-style: none; margin: 0; padding: 0; }
  li.item { padding: 10px 0; border-bottom: 1px dashed #ececec; }
  li.item:last-child { border-bottom: none; }
  .line { display: block; }
  .flag {
    display: block; margin: 6px 0; padding: 7px 11px;
    background: var(--flag-bg); border-left: 4px solid var(--flag-border);
    border-radius: 4px; font-size: 14px; color: #6b3f0a;
  }
  .src { display: block; margin-top: 5px; color: var(--muted);
         font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { margin-top: 26px; color: var(--muted); font-size: 12px; text-align: center; }
`;

/** Wrap the generated handover fragment in a full, styled HTML page. */
export function renderPage(
  fragment: string,
  hotel: HotelMeta,
  stats: RenderStats,
): string {
  const title = `${hotel.name} — Night handover ${hotel.shiftDate}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(hotel.name)} — Night-shift handover</h1>
      <div class="meta">Morning of ${escapeHtml(hotel.shiftDate)} · hotel ${escapeHtml(hotel.id)}</div>
    </header>
    ${fragment}
    <footer>
      ${stats.threadCount} threads · ${stats.flagCount} flags ·
      ${stats.jsonEventCount} structured + ${stats.parsedEventCount} free-text events.
      Source event IDs shown under each item for traceability.
    </footer>
  </div>
</body>
</html>`;
}
