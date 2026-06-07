// Shared data model for the handover pipeline.
//
// Flow: raw inputs -> NormalizedEvent[] -> IssueThread[] -> HTML.
// Every downstream object keeps the source event IDs so any claim in the
// handover can be traced back to its origin (see CLAUDE.md "Debugging").

/** Where an event came from. JSON is system-logged; freetext is parsed by Claude. */
export type Source = "json" | "freetext";

/** Lifecycle status as recorded on a single event. `unknown` is used by the
 *  parser when the free text does not state a resolution — never invented. */
export type EventStatus = "resolved" | "unresolved" | "pending" | "unknown";

/**
 * A single event after normalisation, regardless of source. JSON events and
 * Claude-parsed free-text events both land in this shape so reconciliation can
 * treat them uniformly.
 */
export interface NormalizedEvent {
  id: string;
  /** ISO 8601 timestamp with hotel offset, e.g. 2026-05-27T02:30:00+08:00. */
  timestamp: string;
  type: string;
  room: string | null;
  guest: string | null;
  description: string;
  status: EventStatus;
  source: Source;
  /** Derived "morning" date this event's shift ends on, YYYY-MM-DD. */
  shiftDate: string;
}

/**
 * What the parser is asked to extract from free text. Mirrors the JSON event
 * shape minus the fields we derive ourselves (id, source, shiftDate).
 */
export interface ParsedEvent {
  type: string;
  room: string | null;
  guest: string | null;
  /** English-normalised description of exactly what the text states. */
  description: string;
  status: EventStatus;
}

/** Lifecycle of an issue thread relative to the requested shift date. */
export type Lifecycle =
  | "new_tonight" // first appeared on the target shift
  | "newly_resolved" // was open before, resolved on the target shift
  | "still_open" // carried over and not yet resolved
  | "fyi"; // informational, no open action

/**
 * A grounding flag emitted deterministically by reconcile.ts. These MUST be
 * reproduced verbatim by the handover (CLAUDE.md grounding rule #3).
 */
export interface Flag {
  /** Machine code, e.g. STATUS_CONFLICT, surfaced as `[STATUS_CONFLICT]`. */
  type: string;
  /** Human-readable, operator-facing explanation. */
  message: string;
  /** Source event IDs this flag is derived from. */
  eventIds: string[];
}

/** A group of related events tracked across nights as one issue. */
export interface IssueThread {
  key: string;
  type: string;
  room: string | null;
  /** Events in this thread, oldest first. */
  events: NormalizedEvent[];
  lifecycle: Lifecycle;
  flags: Flag[];
  /** All source event IDs in the thread, for traceability in the output. */
  sourceEventIds: string[];
}

/** Hotel metadata carried through the pipeline for display + logging. */
export interface HotelMeta {
  id: string;
  name: string;
  shiftDate: string;
}
