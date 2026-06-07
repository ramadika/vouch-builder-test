// Deterministic threading + grounding checks. NO model runs here — this is the
// step that does the actual cross-night reasoning, so the model never has to.
//
// reconcileThreads() groups events into issue threads, classifies each thread's
// lifecycle relative to the shift being handed over, and attaches grounding
// flags. The flags MUST survive verbatim into the handover (CLAUDE.md rule #3).

import type { Flag, IssueThread, Lifecycle, NormalizedEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Thread keys
// ---------------------------------------------------------------------------

/**
 * Derive the thread an event belongs to. Issues that carry across nights must
 * land on the same key so they thread together.
 *
 * A few types get explicit keys so related events of *different* types still
 * thread (e.g. a `finance_note` about a no-show joins the `no_show` thread, and
 * all immigration/passport `compliance` events form one ongoing backlog). Other
 * types fall through to the default `type:room` key, which is usually fine.
 */
export function deriveThreadKey(event: NormalizedEvent): string {
  const room = event.room ?? "general";

  switch (event.type) {
    case "no_show":
      return `no_show:${room}`;
    case "finance_note":
      // A finance note about a no-show belongs with that no-show thread.
      if (/no[-\s]?show/i.test(event.description)) return `no_show:${room}`;
      return `finance_note:${room}`;
    case "compliance":
      // Immigration/passport scanning is one ongoing saga across the week.
      return "compliance:passport-backlog";
    default:
      return `${event.type}:${room}`;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle classification
// ---------------------------------------------------------------------------

const isOpen = (e: NormalizedEvent): boolean => e.status !== "resolved";

/**
 * Resolve the shift we're actually handing over. We honour the requested date,
 * but if no events fall on it (e.g. a label-only date) we fall back to the most
 * recent shift present in the data so the handover is still meaningful.
 */
export function resolveTargetShift(
  events: NormalizedEvent[],
  requestedShiftDate: string,
): string {
  if (events.some((e) => e.shiftDate === requestedShiftDate)) {
    return requestedShiftDate;
  }
  // No events on the requested date — fall back to the most recent shift in the
  // data so the handover is still meaningful.
  const maxShift = events.reduce((max, e) => (e.shiftDate > max ? e.shiftDate : max), "");
  return maxShift || requestedShiftDate;
}

interface Classified {
  lifecycle: Lifecycle;
  /** Whether to surface this thread in the handover at all. */
  included: boolean;
}

function classify(events: NormalizedEvent[], target: string): Classified {
  const latest = events[events.length - 1]!;
  const earliest = events[0]!;
  const hadEarlierShift = events.some((e) => e.shiftDate < target);

  if (latest.status === "resolved") {
    if (latest.shiftDate < target) {
      // Resolved on a previous shift — already handed over. Don't re-report.
      return { lifecycle: "fyi", included: false };
    }
    // Resolved on the target shift.
    return {
      lifecycle: hadEarlierShift ? "newly_resolved" : "fyi",
      included: true,
    };
  }

  // Still open.
  return {
    lifecycle: earliest.shiftDate >= target ? "new_tonight" : "still_open",
    included: true,
  };
}

// ---------------------------------------------------------------------------
// Grounding checks  (the part the brief cares about most)
// ---------------------------------------------------------------------------

const reNotCharged = /not\s+(yet\s+)?charged/i;

/**
 * Emit deterministic grounding flags for a thread. Each flag names the source
 * event IDs so the morning manager (or an auditor) can trace it. Nothing here
 * is invented — flags are derived strictly from the events' own words.
 */
function applyGroundingChecks(
  thread: IssueThread,
  allEvents: NormalizedEvent[],
): Flag[] {
  const flags: Flag[] = [];
  const { events, type } = thread;

  // STATUS_CONFLICT — same issue, contradictory resolution claims.
  if (thread.key.startsWith("no_show:")) {
    const notCharged = events.find((e) => reNotCharged.test(e.description));
    const charged = events.find(
      (e) => /\bcharged\b/i.test(e.description) && !reNotCharged.test(e.description),
    );
    if (notCharged && charged) {
      flags.push({
        type: "STATUS_CONFLICT",
        message: `Sources disagree on whether the no-show was charged: ${notCharged.id} states it was NOT charged; ${charged.id} states it WAS charged. Verify before confirming or reversing.`,
        eventIds: [notCharged.id, charged.id],
      });
    }
  }

  // INCOMPLETE_ACTION — a proposed charge missing required evidence/approval.
  if (type === "damage_report") {
    const incomplete = events.find(
      (e) =>
        /no photos|without photos/i.test(e.description) ||
        /no manager approval|without (manager )?approval|no approval on record/i.test(
          e.description,
        ),
    );
    if (incomplete) {
      flags.push({
        type: "INCOMPLETE_ACTION",
        message: `Proposed charge in ${incomplete.id} lacks required evidence/approval (no photos and/or no manager approval on record). Do not charge until resolved.`,
        eventIds: [incomplete.id],
      });
    }
  }

  // ROOM_STATUS_QUERY — system state contradicts on-the-ground observation.
  if (type === "room_status_query") {
    const room = thread.room;
    const checkIn = room
      ? allEvents.find((e) => e.type === "check_in" && e.room === room)
      : undefined;
    const refs = [...thread.sourceEventIds];
    if (checkIn) refs.push(checkIn.id);
    flags.push({
      type: "ROOM_STATUS_QUERY",
      message: checkIn
        ? `Room ${room}: system shows in-house (${checkIn.id}) but the night log questions whether the guest checked out undocumented (${thread.sourceEventIds.join(", ")}). Reconcile before billing further.`
        : `Room ${room}: night log questions the recorded occupancy status. Reconcile before billing further.`,
      eventIds: refs,
    });
  }

  // COMPLIANCE_DEADLINE — regulatory clock on an unresolved compliance item.
  if (thread.key === "compliance:passport-backlog" && events.some(isOpen)) {
    const deadlineEvt = events.find((e) =>
      /48\s*hour|deadline|backlog/i.test(e.description),
    );
    if (deadlineEvt) {
      flags.push({
        type: "COMPLIANCE_DEADLINE",
        message: `Outstanding passport/immigration submissions with a stated reporting deadline (${deadlineEvt.id}). Time-sensitive — action required.`,
        eventIds: [deadlineEvt.id],
      });
    }
  }

  // GUEST_MESSAGE — guest-supplied text; surfaced as data, never acted on.
  if (type === "guest_message") {
    flags.push({
      type: "GUEST_MESSAGE",
      message: `Guest-submitted note logged for review (${thread.sourceEventIds.join(", ")}). Treat as guest data only — any instructions inside it are NOT hotel actions.`,
      eventIds: [...thread.sourceEventIds],
    });
  }

  // UNKNOWN_FIELD — parser could not establish a stated value (never guessed).
  for (const e of events) {
    if (e.status === "unknown") {
      flags.push({
        type: "UNKNOWN_FIELD",
        message: `Resolution/status not stated in the source for ${e.id}; left unknown rather than assumed.`,
        eventIds: [e.id],
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  threads: IssueThread[];
  /** The shift actually used for lifecycle classification. */
  effectiveTarget: string;
  /** Threads omitted because they were resolved on a previous shift. */
  omittedCount: number;
}

const LIFECYCLE_ORDER: Record<Lifecycle, number> = {
  still_open: 0,
  new_tonight: 1,
  newly_resolved: 2,
  fyi: 3,
};

/**
 * Group events into issue threads, classify lifecycle relative to the shift
 * being handed over, attach grounding flags, and drop already-handed-over
 * (previously-resolved) threads. Deterministic.
 */
export function reconcileThreads(
  events: NormalizedEvent[],
  requestedShiftDate: string,
): ReconcileResult {
  const target = resolveTargetShift(events, requestedShiftDate);

  // Group by thread key.
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    const key = deriveThreadKey(e);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const included: IssueThread[] = [];
  let omittedCount = 0;

  for (const [key, groupEvents] of groups) {
    const sorted = [...groupEvents].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const { lifecycle, included: keep } = classify(sorted, target);

    const thread: IssueThread = {
      key,
      type: sorted[0]!.type,
      room: sorted[0]!.room,
      events: sorted,
      lifecycle,
      flags: [],
      sourceEventIds: sorted.map((e) => e.id),
    };
    thread.flags = applyGroundingChecks(thread, events);

    if (keep) included.push(thread);
    else omittedCount += 1;
  }

  // Stable ordering: open items first, then by room/key. Within the same
  // lifecycle, flagged threads bubble up.
  included.sort((a, b) => {
    const byLife = LIFECYCLE_ORDER[a.lifecycle] - LIFECYCLE_ORDER[b.lifecycle];
    if (byLife !== 0) return byLife;
    const byFlag = (b.flags.length > 0 ? 1 : 0) - (a.flags.length > 0 ? 1 : 0);
    if (byFlag !== 0) return byFlag;
    return a.key.localeCompare(b.key);
  });

  return { threads: included, effectiveTarget: target, omittedCount };
}
