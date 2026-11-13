import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { OrchestrationV2DomainEventJson, ApplicationProjectEvent } from "@t3tools/contracts";
import { runMigrations } from "../../apps/server/src/persistence/Migrations.ts";
import * as ProjectionStore from "../../apps/server/src/orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../apps/server/src/orchestration-v2/ProjectStore.ts";
const home = await NodeFSP.realpath(process.argv[2]);
const liveHome = await NodeFSP.realpath(NodePath.join(NodeOS.homedir(), ".t3"));
if (home === liveHome || home.startsWith(liveHome + NodePath.sep))
  throw new Error("Validation is only allowed on a separate fork home.");
const filename = NodePath.join(home, "userdata", "statev2.sqlite");
const read = new NodeSqlite.DatabaseSync(filename, { readOnly: true });
const imported = read
  .prepare(
    "SELECT * FROM orchestration_events WHERE event_id LIKE 'fork-import:%' ORDER BY sequence",
  )
  .all();
read.close();
const decode = Schema.decodeUnknownSync(OrchestrationV2DomainEventJson);
const decodeProject = Schema.decodeUnknownSync(ApplicationProjectEvent);
const events = imported.map((row) =>
  row.aggregate_kind === "thread"
    ? decode({
        id: row.event_id,
        threadId: row.stream_id,
        type: row.event_type,
        occurredAt: row.occurred_at,
        payload: JSON.parse(row.payload_json),
      })
    : decodeProject({
        sequence: row.sequence,
        eventId: row.event_id,
        aggregateKind: "project",
        aggregateId: row.stream_id,
        type: row.event_type,
        occurredAt: row.occurred_at,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: JSON.parse(row.payload_json),
      }),
);
console.log(`Validated ${events.length} import events against the real contracts`);
const stores = Layer.mergeAll(ProjectionStore.layer, ProjectStore.layer).pipe(
  Layer.provideMerge(NodeSqliteClient.layer({ filename })),
  Layer.provide(NodeServices.layer),
);
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* runMigrations();
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const projects = yield* ProjectStore.ProjectStoreV2;
      for (const event of events) {
        if (event.aggregateKind === "project") yield* projects.apply(event);
        else yield* projections.apply(event);
      }
      const candidates = {};
      for (const kind of [
        "runtime",
        "queued-runs",
        "delegated-completions",
        "restart-continuations",
        "subagent-results",
      ]) {
        candidates[kind] = (yield* projections.getRecoveryThreadIds(kind)).length;
      }
      const unreadable = yield* projections.getUnreadableThreadIds();
      console.log(JSON.stringify({ candidates, unreadableThreads: unreadable.length }));
      if (
        unreadable.length ||
        candidates.runtime ||
        candidates["queued-runs"] ||
        candidates["delegated-completions"] ||
        candidates["restart-continuations"]
      )
        throw new Error("Snapshot still has unreadable or executable recovery state.");
    }).pipe(Effect.provide(stores)),
  ),
);
