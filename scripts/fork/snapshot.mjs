import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
const active = ["pending", "preparing", "queued", "starting", "running", "waiting"];
const runtimeTables = [
  "orchestration_v2_effect_outbox",
  "orchestration_v2_thread_launch_workflows",
  "provider_session_runtime",
  "auth_sessions",
  "auth_pairing_links",
  "peer_environment_links",
];
export function freezeSnapshot(db) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name),
  );
  const counts = {};
  const now = new Date().toISOString();
  const eventTypes = {
    runs: "run.updated",
    run_attempts: "run-attempt.updated",
    nodes: "node.updated",
    provider_turns: "provider-turn.updated",
    subagents: "subagent.updated",
    turn_items: "turn-item.updated",
    provider_sessions: "provider-session.updated",
    provider_threads: "provider-thread.updated",
    runtime_requests: "runtime-request.updated",
    threads: "thread.metadata-updated",
    messages: "message.updated",
  };
  const append = tables.has("orchestration_events")
    ? db.prepare(`INSERT INTO orchestration_events
    (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id,
      causation_event_id, correlation_id, actor_kind, payload_json, metadata_json, application_event_version)
    VALUES (?, 'thread', ?, COALESCE((SELECT MAX(stream_version) + 1 FROM orchestration_events
      WHERE aggregate_kind = 'thread' AND stream_id = ?), 0), ?, ?, NULL, NULL, NULL, 'server', ?, '{}', 2)`)
    : null;
  const updatePayloads = (table, change, where = "1") => {
    if (!tables.has(table)) return;
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    const primary = columns.filter((column) => column.pk).map((column) => column.name);
    if (!primary.length || !columns.some((column) => column.name === "payload_json")) return;
    const names = new Set(columns.map((column) => column.name));
    const set = [
      "payload_json",
      "status",
      "completed_at",
      "resolved_at",
      "streaming",
      "active_provider_thread_id",
      "scripts_json",
      "completion_delivery_state",
    ].filter((column) => names.has(column) && !primary.includes(column));
    const update = db.prepare(
      `UPDATE "${table}" SET ${set.map((column) => `"${column}" = ?`).join(", ")} WHERE ${primary.map((column) => `"${column}" = ?`).join(" AND ")}`,
    );
    const rows = db.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all();
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json);
      change(payload, row);
      row.payload_json = JSON.stringify(payload);
      update.run(...set.map((column) => row[column]), ...primary.map((column) => row[column]));
      const eventType = eventTypes[table.replace("orchestration_v2_projection_", "")];
      const threadIds = row.thread_id
        ? [row.thread_id]
        : table.endsWith("provider_sessions") &&
            tables.has("orchestration_v2_projection_provider_session_bindings")
          ? db
              .prepare(
                "SELECT thread_id FROM orchestration_v2_projection_provider_session_bindings WHERE provider_session_id = ?",
              )
              .all(row.provider_session_id)
              .map((binding) => binding.thread_id)
          : [];
      if (append && eventType)
        for (const threadId of threadIds)
          append.run(
            `fork-import:${NodeCrypto.randomUUID()}`,
            threadId,
            threadId,
            eventType,
            now,
            row.payload_json,
          );
    }
    counts[table] = rows.length;
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of runtimeTables) if (tables.has(table)) db.exec(`DELETE FROM "${table}"`);
    if (tables.has("scheduled_tasks")) {
      const columns = db.prepare("PRAGMA table_info(scheduled_tasks)").all();
      if (!columns.some((column) => column.name === "enabled"))
        throw new Error("Unknown scheduled task schema. Snapshot remains offline.");
      db.exec("UPDATE scheduled_tasks SET enabled = 0");
    }
    const statusWhere = `status IN (${active.map((status) => `'${status}'`).join(",")})`;
    for (const suffix of [
      "runs",
      "run_attempts",
      "nodes",
      "provider_turns",
      "subagents",
      "turn_items",
    ]) {
      updatePayloads(
        `orchestration_v2_projection_${suffix}`,
        (payload, row) => {
          payload.status = row.status = "cancelled";
          if ("completedAt" in payload) payload.completedAt = now;
          if ("completed_at" in row) row.completed_at = now;
        },
        statusWhere,
      );
    }
    updatePayloads("orchestration_v2_projection_subagents", (payload, row) => {
      if ([...active, "idle"].includes(payload.status)) {
        payload.status = row.status = "cancelled";
        payload.completedAt = now;
      }
      payload.completionDelivery = { state: "disposed", observedByRunId: null };
      if ("completion_delivery_state" in row) row.completion_delivery_state = "disposed";
      if (payload.childThreadId && payload.result === null) {
        const run = db
          .prepare(
            "SELECT run_id FROM orchestration_v2_projection_runs WHERE thread_id = ? ORDER BY ordinal DESC LIMIT 1",
          )
          .get(payload.childThreadId);
        if (run) payload.cancelledRunId = run.run_id;
      }
    });
    updatePayloads(
      "orchestration_v2_projection_runs",
      (payload) => {
        if (payload.delegatedCompletion) {
          payload.delegatedCompletion.disposition = "disposed";
          payload.delegatedCompletion.delivery = null;
        }
      },
      "json_type(payload_json, '$.delegatedCompletion') = 'object'",
    );
    updatePayloads("orchestration_v2_projection_provider_sessions", (payload, row) => {
      payload.status = row.status = "stopped";
      payload.extensionStatuses = [];
    });
    updatePayloads(
      "orchestration_v2_projection_provider_threads",
      (payload, row) => {
        payload.status = row.status = "idle";
        payload.pendingBackgroundTasks = [];
      },
      "status = 'active' OR json_array_length(payload_json, '$.pendingBackgroundTasks') > 0",
    );
    updatePayloads(
      "orchestration_v2_projection_runtime_requests",
      (payload, row) => {
        payload.status = row.status = "cancelled";
        payload.resolvedAt = row.resolved_at = now;
      },
      "status = 'pending'",
    );
    updatePayloads(
      "orchestration_v2_projection_threads",
      (payload, row) => {
        payload.activeProviderThreadId = row.active_provider_thread_id = null;
        payload.limitRecovery = null;
        payload.titleRegeneration = null;
        payload.pullRequests = (payload.pullRequests ?? []).map(
          ({ watch: _watch, ...link }) => link,
        );
      },
      "active_provider_thread_id IS NOT NULL OR json_extract(payload_json, '$.limitRecovery') IS NOT NULL OR json_extract(payload_json, '$.titleRegeneration') IS NOT NULL OR EXISTS (SELECT 1 FROM json_each(payload_json, '$.pullRequests') WHERE json_extract(value, '$.watch') IS NOT NULL)",
    );
    updatePayloads(
      "orchestration_v2_projection_messages",
      (payload, row) => {
        payload.streaming = false;
        row.streaming = 0;
      },
      "streaming = 1",
    );
    if (tables.has("projection_projects")) {
      if (append)
        for (const row of db.prepare("SELECT project_id FROM projection_projects").all()) {
          db.prepare(`INSERT INTO orchestration_events
          (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id,
           causation_event_id, correlation_id, actor_kind, payload_json, metadata_json, application_event_version)
          VALUES (?, 'project', ?, COALESCE((SELECT MAX(stream_version) + 1 FROM orchestration_events
           WHERE aggregate_kind = 'project' AND stream_id = ?), 0), 'project.meta-updated', ?, NULL, NULL, NULL, 'server', ?, '{}', 2)`).run(
            `fork-import:${NodeCrypto.randomUUID()}`,
            row.project_id,
            row.project_id,
            now,
            JSON.stringify({ projectId: row.project_id, scripts: [], updatedAt: now }),
          );
        }
      db.exec("UPDATE projection_projects SET scripts_json = '[]'");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return counts;
}
export async function snapshot(sourceHome, destinationHome) {
  const source = await NodeFSP.realpath(sourceHome);
  if (
    await NodeFSP.stat(NodePath.resolve(destinationHome)).then(
      () => true,
      () => false,
    )
  ) {
    throw new Error(
      "Choose a new empty destination home. Existing fork data is never overwritten.",
    );
  }
  const absoluteDestination = NodePath.resolve(destinationHome);
  const destination = NodePath.join(
    await NodeFSP.realpath(NodePath.dirname(absoluteDestination)),
    NodePath.basename(absoluteDestination),
  );
  const relative = NodePath.relative(source, destination);
  const reverse = NodePath.relative(destination, source);
  if (
    !relative ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative)) ||
    (!reverse.startsWith(`..${NodePath.sep}`) && reverse !== ".." && !NodePath.isAbsolute(reverse))
  ) {
    throw new Error("The fork home must be outside the source T3 home.");
  }
  await NodeFSP.mkdir(destination, { mode: 0o700 });
  const target = NodePath.join(destination, "userdata");
  await NodeFSP.mkdir(target, { recursive: true });
  const databasePath = NodePath.join(target, "statev2.sqlite");
  if (
    await NodeFSP.stat(databasePath).then(
      () => true,
      () => false,
    )
  )
    throw new Error("Destination database exists. Choose a new home to preserve fork changes.");
  const sourcePath = NodePath.join(source, "userdata", "statev2.sqlite");
  const live = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
  try {
    live.exec("BEGIN");
    live.prepare("SELECT COUNT(*) FROM sqlite_schema").get();
    await NodeSqlite.backup(live, databasePath, { rate: 32768 });
  } finally {
    if (live.isTransaction) live.exec("ROLLBACK");
    live.close();
  }
  const db = new NodeSqlite.DatabaseSync(databasePath);
  let report;
  try {
    const counts = {};
    for (const table of [
      "projection_projects",
      "orchestration_v2_projection_threads",
      "orchestration_v2_projection_messages",
      "orchestration_events",
    ]) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    }
    const frozen = freezeSnapshot(db);
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.some((row) => Object.values(row)[0] !== "ok"))
      throw new Error("Snapshot failed SQLite quick_check.");
    report = { createdAt: new Date().toISOString(), counts, frozen, integrity: "ok" };
  } finally {
    db.close();
  }
  for (const name of [
    "attachments",
    "themes",
    "secrets",
    "settings.json",
    "client-settings.json",
    "keybindings.json",
  ]) {
    const input = NodePath.join(source, "userdata", name);
    if (
      await NodeFSP.stat(input).then(
        () => true,
        () => false,
      )
    )
      await NodeFSP.cp(input, NodePath.join(target, name), {
        recursive: true,
        dereference: true,
        filter: (entry) =>
          name !== "secrets" ||
          !/^(?:files(?:[\\/]|$)|cloud-|dpop-|server-signing-|mcp-oauth-|asset-access-|secret-request-salt)/.test(
            NodePath.relative(input, entry),
          ),
      });
  }
  const settingsPath = NodePath.join(target, "settings.json");
  const settings = await NodeFSP.readFile(settingsPath, "utf8").then(JSON.parse, () => ({}));
  await NodeFSP.writeFile(
    NodePath.join(destination, "original-settings.json"),
    JSON.stringify(settings, null, 2) + "\n",
  );
  Object.assign(settings, {
    idleCompaction: "off",
    compactIdleThreads: false,
    autoResumeLimitedThreads: false,
    continueThreadsAfterServerUpdate: false,
    defaultProjectScripts: [],
    projectScriptOverrides: {},
    worktreeCleanup: { mode: "off" },
  });
  for (const overrides of Object.values(settings.projectSettingsOverrides ?? {})) {
    Object.assign(overrides, {
      idleCompaction: "off",
      compactIdleThreads: false,
      autoResumeLimitedThreads: false,
      continueThreadsAfterServerUpdate: false,
      defaultProjectScripts: [],
      worktreeCleanup: { mode: "off" },
    });
  }
  settings.storageCleanup = {
    worktreeAfterDays: null,
    worktreeSettledAfterDays: null,
    worktreeOnMerge: false,
    worktreeOnDelete: false,
    worktreeUnchanged: false,
    browserArtifactsAfterDays: null,
    logsAfterDays: null,
  };
  await NodeFSP.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  await NodeFSP.writeFile(
    NodePath.join(destination, "snapshot-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const destination = process.argv[2];
  if (!destination)
    throw new Error("Usage: node scripts/fork/snapshot.mjs <new-home> [source-home]");
  await snapshot(process.argv[3] ?? NodePath.join(NodeOS.homedir(), ".t3"), destination);
}
