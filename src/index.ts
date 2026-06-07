// Hono server: POST /handover runs the 3-step pipeline; GET /health for the
// platform. Structured pino logs at every pipeline step so another builder (or
// an AI agent) can debug a bad handover: which hotel, which night, why.

import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import pino from "pino";
import { z } from "zod";

import { normaliseEvents, type EventsDocument } from "./normalise.js";
import { parseNightLog, generateHandover } from "./prompts.js";
import { reconcileThreads } from "./reconcile.js";
import { renderPage } from "./html.js";
import type { HotelMeta, NormalizedEvent } from "./types.js";

// --- minimal .env loader (no dependency) -----------------------------------
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1]! in process.env)) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const PORT = Number(process.env.PORT ?? 3000);

// --- request validation ----------------------------------------------------
const HandoverBody = z.object({
  hotelId: z.string().min(1),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "shiftDate must be YYYY-MM-DD"),
  eventsJson: z
    .object({ events: z.array(z.unknown()) })
    .passthrough()
    .describe("Parsed events.json document"),
  nightLogMd: z.string().optional(),
});

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/handover", async (c) => {
  const requestId = `req_${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();

  // 1. Validate.
  let body: z.infer<typeof HandoverBody>;
  try {
    body = HandoverBody.parse(await c.req.json());
  } catch (err) {
    const issues = err instanceof z.ZodError ? err.issues : String(err);
    log.warn({ requestId, step: "validation_failed", issues }, "bad request");
    return c.json({ error: "invalid request body", details: issues }, 400);
  }

  const { hotelId, shiftDate, eventsJson, nightLogMd } = body;
  const doc = eventsJson as unknown as EventsDocument;
  const baseLog = { requestId, hotelId, shiftDate };

  try {
    // 2. Normalise structured events (deterministic).
    const jsonEvents = normaliseEvents(doc);
    log.info(
      {
        ...baseLog,
        step: "events_normalised",
        jsonEventCount: jsonEvents.length,
        eventIds: jsonEvents.map((e) => e.id),
      },
      "normalised structured events",
    );

    // 3. Parse the free-text log with Claude (only if provided).
    let parsedEvents: NormalizedEvent[] = [];
    if (nightLogMd && nightLogMd.trim()) {
      const parsed = await parseNightLog(
        nightLogMd,
        shiftDate,
        doc.hotel?.timezone ?? "+08:00",
      );
      parsedEvents = parsed.events;
      log.info(
        {
          ...baseLog,
          step: "parse_output",
          parsedEventCount: parsedEvents.length,
          rawShiftDate: parsed.rawShiftDate,
          parsed: parsedEvents.map((e) => ({
            id: e.id,
            type: e.type,
            room: e.room,
            status: e.status,
            description: e.description,
          })),
        },
        "parsed free-text night log",
      );
    }

    // 4. Merge + 5. reconcile into threads (deterministic).
    const allEvents = [...jsonEvents, ...parsedEvents];
    const { threads, effectiveTarget, omittedCount } = reconcileThreads(
      allEvents,
      shiftDate,
    );
    const flagCount = threads.reduce((n, t) => n + t.flags.length, 0);

    log.info(
      {
        ...baseLog,
        step: "threads_reconciled",
        effectiveTarget,
        threadCount: threads.length,
        omittedCount,
        flagCount,
        threads: threads.map((t) => ({
          key: t.key,
          lifecycle: t.lifecycle,
          flags: t.flags.map((f) => f.type),
          sourceEventIds: t.sourceEventIds,
        })),
      },
      "reconciled issue threads",
    );

    // 6. Generate the grounded handover with Claude.
    const hotel: HotelMeta = {
      id: hotelId,
      name: doc.hotel?.name ?? hotelId,
      shiftDate: effectiveTarget,
    };
    const fragment = await generateHandover(threads, hotel);

    log.info(
      {
        ...baseLog,
        step: "handover_complete",
        effectiveTarget,
        threadCount: threads.length,
        flagCount,
        parsedEventCount: parsedEvents.length,
        jsonEventCount: jsonEvents.length,
        durationMs: Date.now() - startedAt,
      },
      "handover complete",
    );

    // 7. Respond: JSON if asked, else the full HTML page.
    const wantsJson = (c.req.header("accept") ?? "").includes("application/json");
    const page = renderPage(fragment, hotel, {
      jsonEventCount: jsonEvents.length,
      parsedEventCount: parsedEvents.length,
      threadCount: threads.length,
      flagCount,
    });

    if (wantsJson) {
      return c.json({
        hotelId,
        shiftDate: effectiveTarget,
        threads,
        flags: threads.flatMap((t) =>
          t.flags.map((f) => ({ ...f, threadKey: t.key })),
        ),
        html: page,
      });
    }
    return c.html(page);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      log.error(
        { ...baseLog, step: "claude_error", status: err.status, message: err.message },
        "Claude API error",
      );
      return c.json({ error: "upstream model error", requestId }, 502);
    }
    log.error(
      { ...baseLog, step: "pipeline_error", message: String(err) },
      "pipeline error",
    );
    return c.json({ error: "internal error", requestId }, 500);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info({ port: info.port }, "vouch handover service listening");
});
