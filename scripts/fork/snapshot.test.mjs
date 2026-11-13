import * as NodeSqlite from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { freezeSnapshot } from "./snapshot.mjs";
describe("fork snapshot", () => {
  it("retains all thread families and history while cancelling queued and active work", () => {
    const db = new NodeSqlite.DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, active_provider_thread_id TEXT, payload_json TEXT);
        CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, status TEXT, completed_at TEXT, payload_json TEXT);
        CREATE TABLE orchestration_v2_projection_subagents (subagent_id TEXT PRIMARY KEY, thread_id TEXT, status TEXT, payload_json TEXT, completion_delivery_state TEXT);
        CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, thread_id TEXT, streaming INTEGER, payload_json TEXT);
        CREATE TABLE scheduled_tasks (enabled INTEGER);
        CREATE TABLE orchestration_v2_effect_outbox (status TEXT);
        CREATE TABLE auth_sessions (token TEXT);
        CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, scripts_json TEXT);
        CREATE TABLE orchestration_events (sequence INTEGER PRIMARY KEY, event_id TEXT, aggregate_kind TEXT, stream_id TEXT, stream_version INTEGER, event_type TEXT, occurred_at TEXT, command_id TEXT, causation_event_id TEXT, correlation_id TEXT, actor_kind TEXT, payload_json TEXT, metadata_json TEXT, application_event_version INTEGER);
        INSERT INTO scheduled_tasks VALUES (1);
        INSERT INTO orchestration_v2_effect_outbox VALUES ('pending');
        INSERT INTO auth_sessions VALUES ('old-auth');
        INSERT INTO projection_projects VALUES ('project', '[{"runOnSettle":true}]');
      `);
      const addThread = db.prepare(
        "INSERT INTO orchestration_v2_projection_threads VALUES (?, 'native', ?)",
      );
      for (const id of ["active", "archived", "child"])
        addThread.run(
          id,
          JSON.stringify({
            id,
            lineage: { rootThreadId: "active" },
            pullRequests: [{ watch: { enabled: true }, url: "https://example.com" }],
          }),
        );
      const addRun = db.prepare(
        "INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, 1, ?, NULL, ?)",
      );
      for (const [id, status] of [
        ["active", "running"],
        ["archived", "completed"],
        ["child", "queued"],
      ])
        addRun.run(id, id, status, JSON.stringify({ id, status, completedAt: null }));
      db.prepare(
        "INSERT INTO orchestration_v2_projection_subagents VALUES ('task', 'active', 'running', ?, 'pending')",
      ).run(JSON.stringify({ status: "running", childThreadId: "child", result: null }));
      for (const status of ["idle", "completed"])
        db.prepare(
          "INSERT INTO orchestration_v2_projection_subagents VALUES (?, 'active', ?, ?, 'claimed')",
        ).run(status, status, JSON.stringify({ status, childThreadId: "child", result: null }));
      db.prepare(
        "INSERT INTO orchestration_v2_projection_messages VALUES ('message', 'active', 1, ?)",
      ).run(JSON.stringify({ text: "history", streaming: true }));
      freezeSnapshot(db);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM orchestration_v2_projection_threads").get().n,
      ).toBe(3);
      expect(
        db
          .prepare("SELECT status FROM orchestration_v2_projection_runs ORDER BY run_id")
          .all()
          .map((row) => row.status),
      ).toEqual(["cancelled", "completed", "cancelled"]);
      expect(db.prepare("SELECT enabled FROM scheduled_tasks").get().enabled).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM orchestration_v2_effect_outbox").get().n).toBe(
        0,
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n).toBe(0);
      const message = JSON.parse(
        db.prepare("SELECT payload_json FROM orchestration_v2_projection_messages").get()
          .payload_json,
      );
      expect(message).toEqual({ text: "history", streaming: false });
      const task = JSON.parse(
        db
          .prepare(
            "SELECT payload_json FROM orchestration_v2_projection_subagents WHERE subagent_id = 'task'",
          )
          .get().payload_json,
      );
      expect(task.cancelledRunId).toBe("child");
      expect(task.completionDelivery.state).toBe("disposed");
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM orchestration_v2_projection_subagents WHERE completion_delivery_state <> 'disposed'",
          )
          .get().n,
      ).toBe(0);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM orchestration_events WHERE event_type = 'project.meta-updated' AND json_array_length(payload_json, '$.scripts') = 0",
          )
          .get().n,
      ).toBe(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM orchestration_events WHERE event_type = 'run.updated'",
          )
          .get().n,
      ).toBe(2);
      expect(
        JSON.parse(
          db.prepare("SELECT payload_json FROM orchestration_v2_projection_threads LIMIT 1").get()
            .payload_json,
        ).pullRequests[0],
      ).toEqual({ url: "https://example.com" });
    } finally {
      db.close();
    }
  });
});
