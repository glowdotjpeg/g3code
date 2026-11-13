import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
const git = (...args) => NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args) => NodeChildProcess.execFileSync("gh", args, { encoding: "utf8" }).trim();
const base = "g3code";
const repo = process.env.GITHUB_REPOSITORY;
if (!repo || repo === "pingdotgg/t3code")
  throw new Error("Run this workflow in your personal fork.");
if (process.argv[2] === "publish") {
  const head = git("rev-parse", "HEAD");
  const upstream = process.env.UPSTREAM_SHA;
  const branch = `updates/t3code-${upstream.slice(0, 12)}-${git("rev-parse", `origin/${base}`).slice(0, 12)}`;
  git("push", "origin", `HEAD:refs/heads/${branch}`);
  gh(
    "api",
    `repos/${repo}/check-runs`,
    "--method",
    "POST",
    "-f",
    "name=Fork merged update",
    "-f",
    `head_sha=${head}`,
    "-f",
    "status=completed",
    "-f",
    "conclusion=success",
    "-f",
    `details_url=https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  );
  NodeFS.writeFileSync(
    "upstream-update-body.md",
    `Merge upstream T3 Code main (${upstream}) while preserving the fork changes.\n\nThe merged commit ${head} passed the update workflow checks. The result is attached to this commit as Fork merged update.\n\nModel: GPT-6.1 Sol. Harness: Codex.`,
  );
  const existing = JSON.parse(
    gh(
      "pr",
      "list",
      "--repo",
      repo,
      "--base",
      base,
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number",
    ),
  )[0];
  console.log(
    existing
      ? gh(
          "pr",
          "edit",
          String(existing.number),
          "--repo",
          repo,
          "--body-file",
          "upstream-update-body.md",
        )
      : gh(
          "pr",
          "create",
          "--repo",
          repo,
          "--base",
          base,
          "--head",
          branch,
          "--title",
          "chore: update from upstream T3 Code",
          "--body-file",
          "upstream-update-body.md",
        ),
  );
} else {
  git("fetch", "origin", base);
  git("fetch", "https://github.com/pingdotgg/t3code.git", "main");
  const upstream = git("rev-parse", "FETCH_HEAD");
  if (
    NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", upstream, `origin/${base}`])
      .status === 0
  ) {
    console.log("The fork already contains upstream main.");
    process.exit(0);
  }
  git("switch", "--create", "fork-update-candidate", `origin/${base}`);
  const merged = NodeChildProcess.spawnSync("git", ["merge", "--no-edit", upstream], {
    encoding: "utf8",
  });
  if (merged.status !== 0) {
    const conflicts = git("diff", "--name-only", "--diff-filter=U");
    git("merge", "--abort");
    if (!conflicts) throw new Error(merged.stderr || merged.stdout || "Upstream merge failed.");
    const title = "T3 Code update needs conflict resolution";
    NodeFS.writeFileSync(
      "upstream-update-body.md",
      `Upstream main: ${upstream}\n\nYour changes are preserved. Resolve these conflicts before updating:\n\n${conflicts
        .split("\n")
        .map((file) => `- ${file}`)
        .join("\n")}\n\nThis issue is refreshed by the upstream update workflow.`,
    );
    const existing = JSON.parse(
      gh(
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--search",
        `${title} in:title`,
        "--json",
        "number,title",
      ),
    ).find((issue) => issue.title === title);
    console.log(
      existing
        ? gh(
            "issue",
            "edit",
            String(existing.number),
            "--repo",
            repo,
            "--body-file",
            "upstream-update-body.md",
          )
        : gh(
            "issue",
            "create",
            "--repo",
            repo,
            "--title",
            title,
            "--body-file",
            "upstream-update-body.md",
          ),
    );
  } else if (process.env.GITHUB_OUTPUT) {
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `merged=true\nupstream=${upstream}\n`);
  }
}
