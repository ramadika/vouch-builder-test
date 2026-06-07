// Offline smoke test for the deterministic core (no API key needed).
// Mimics what parseNightLog() would return for data/night-logs.md, then runs
// normalise + reconcile and asserts the key grounding flags fire.
//
//   npx tsx scripts/verify-core.ts

import { readFileSync } from "node:fs";
import { normaliseEvents, type EventsDocument } from "../src/normalise.js";
import { reconcileThreads } from "../src/reconcile.js";
import type { NormalizedEvent } from "../src/types.js";

const doc = JSON.parse(readFileSync("data/events.json", "utf8")) as EventsDocument;
const jsonEvents = normaliseEvents(doc);

// Fixture standing in for the Claude parser's output on the Wed 27->28 log.
const shiftDate = "2026-05-28";
const ft = (
  i: number,
  type: string,
  room: string | null,
  status: NormalizedEvent["status"],
  description: string,
): NormalizedEvent => ({
  id: `ft_0${i}`,
  timestamp: `${shiftDate}T05:0${i}:00+08:00`,
  type,
  room,
  guest: null,
  description,
  status,
  source: "freetext",
  shiftDate,
});

const parsed: NormalizedEvent[] = [
  ft(1, "maintenance", "112", "unresolved", "Aircon compressor needs ordering; 112 stays out of order."),
  ft(2, "facilities", null, "unresolved", "2nd floor corridor leak near 215 got worse; building mgmt notified, not fixed."),
  ft(3, "no_show", "312", "resolved", "Charged the one-night no-show fee per booking terms; considers it settled."),
  ft(4, "deposit_issue", "309", "unresolved", "309 deposit from Tuesday still not settled."),
  ft(5, "room_status_query", "205", "unresolved", "205 door ajar, bed not slept in, no luggage; system shows in-house — possible undocumented checkout."),
  ft(6, "maintenance", "208", "unresolved", "208 safe box won't open; passport and cash locked inside, guest flies out tomorrow; needs locksmith urgently."),
];

const all = [...jsonEvents, ...parsed];
const { threads, effectiveTarget, omittedCount } = reconcileThreads(all, "2026-05-31");

console.log(`effectiveTarget=${effectiveTarget}  threads=${threads.length}  omitted=${omittedCount}\n`);
for (const t of threads) {
  console.log(`• ${t.key}  [${t.lifecycle}]  src=${t.sourceEventIds.join(",")}`);
  for (const f of t.flags) console.log(`    ⚑ [${f.type}] ${f.message}`);
}

// Assertions for the known quirks.
const flatFlags = threads.flatMap((t) => t.flags.map((f) => f.type));
const checks: [string, boolean][] = [
  ["STATUS_CONFLICT on no_show:312", threads.some((t) => t.key === "no_show:312" && t.flags.some((f) => f.type === "STATUS_CONFLICT"))],
  ["ROOM_STATUS_QUERY on 205", threads.some((t) => t.key === "room_status_query:205" && t.flags.some((f) => f.type === "ROOM_STATUS_QUERY"))],
  ["INCOMPLETE_ACTION on damage 226", threads.some((t) => t.key === "damage_report:226" && t.flags.some((f) => f.type === "INCOMPLETE_ACTION"))],
  ["COMPLIANCE_DEADLINE on passport backlog", threads.some((t) => t.key === "compliance:passport-backlog" && t.flags.some((f) => f.type === "COMPLIANCE_DEADLINE"))],
  ["GUEST_MESSAGE on 214 (injection)", threads.some((t) => t.key === "guest_message:214" && t.flags.some((f) => f.type === "GUEST_MESSAGE"))],
  ["208 safe-box threaded as still_open", threads.some((t) => t.key === "maintenance:208" && t.lifecycle === "still_open")],
];

console.log("\n--- assertions ---");
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${name}`);
  if (!pass) ok = false;
}
console.log(`\nflags seen: ${[...new Set(flatFlags)].join(", ")}`);
process.exit(ok ? 0 : 1);
