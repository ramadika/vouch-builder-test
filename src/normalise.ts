// Deterministic normalisation of the structured events.json into
// NormalizedEvent[]. No model involved — pure TypeScript.

import type { EventStatus, NormalizedEvent } from "./types.js";

/** Shape of a raw event as it appears in data/events.json. */
interface RawEvent {
  id: string;
  timestamp: string;
  type: string;
  room?: string | null;
  guest?: string | null;
  description: string;
  status?: string;
}

/** Shape of the events.json document. */
export interface EventsDocument {
  hotel?: { id?: string; name?: string; rooms?: number; timezone?: string };
  note?: string;
  events: RawEvent[];
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/;

/** Add one calendar day to a YYYY-MM-DD string, month/year-safe. */
function addOneDay(dateStr: string): string {
  // Anchor at noon UTC so the +1 day never crosses a DST/offset boundary.
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Map an event's local timestamp to the "morning" date its shift ends on.
 *
 * A night shift runs ~23:00–07:00 and spans two calendar dates, so events are
 * bucketed to the morning the shift hands over. We read the local wall-clock
 * date/hour directly from the ISO string (the hotel offset is embedded), so no
 * timezone conversion is needed.
 *
 *   23:00–23:59  -> next calendar day  (shift just started, ends tomorrow am)
 *   00:00–22:59  -> same calendar day  (early-morning + daytime events)
 */
export function shiftDateFor(timestamp: string): string {
  const m = ISO_LOCAL.exec(timestamp);
  if (!m) return timestamp.slice(0, 10); // best-effort fallback
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const hour = Number(m[4]);
  return hour >= 23 ? addOneDay(date) : date;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "unresolved",
  "pending",
  "unknown",
]);

function coerceStatus(raw: string | undefined): EventStatus {
  if (raw && KNOWN_STATUSES.has(raw)) return raw as EventStatus;
  // Unrecognised/missing status is treated as still-open rather than invented.
  return "unresolved";
}

/**
 * Convert a parsed events.json document into NormalizedEvent[]. Deterministic:
 * the same input always yields the same output.
 */
export function normaliseEvents(doc: EventsDocument): NormalizedEvent[] {
  return doc.events.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    type: e.type,
    room: e.room ?? null,
    guest: e.guest ?? null,
    description: e.description,
    status: coerceStatus(e.status),
    source: "json" as const,
    shiftDate: shiftDateFor(e.timestamp),
  }));
}
