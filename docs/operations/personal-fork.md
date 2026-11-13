# G3Code

This fork starts from Maria's complete redesign stack, ending at
[PR 28845](https://github.com/pingdotgg/t3code/pull/28845), commit
`534a0f02d0a1ec8b76cb9be5e2ca781c882cb9bf`.

The `g3code` branch holds the personal version. `upstream` points to
`https://github.com/pingdotgg/t3code.git`; `origin` points to your GitHub fork.
The upstream update workflow checks every six hours. Clean merges become update
PRs with checks on the merged tree. Conflicts create or refresh an issue listing
the affected files. Updates require review and never replace the personal branch.
GitHub Actions must be enabled on the fork for scheduled checks to run.

## Run locally on Windows

Install the locked dependencies with `pnpm install --frozen-lockfile`, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fork/start.ps1
```

Add `-Desktop` for the Electron development app. The launcher always uses
`~/.g3code`, separate from the installed client's `~/.t3` home. Follow the local
pairing URL printed by the development runner. Your installed client stays usable.

## Import existing history

With the fork stopped and a new destination home:

```powershell
node scripts/fork/snapshot.mjs "$env:USERPROFILE\.g3code"
```

The source is opened read-only and copied with SQLite's online backup API, which
includes committed WAL data. All projects, threads, messages and event history
are retained, including archived threads and subagents. Attachments, themes,
provider settings, local secrets and keybindings are copied locally. Personal
data stays outside the repository.

Copied work is cancelled, schedules are disabled, project scripts are cleared,
and authentication, peer links and executable runtime queues are reset. Settle
scripts and PR watches are removed from the copy. A fresh environment identity
and pairing are created when the fork starts. `snapshot-report.json` records
counts and SQLite validation. The importer refuses to overwrite a destination
database. Use a new destination for a later snapshot, then choose which home to
keep after reviewing it. There is no automatic bidirectional history merge.

Projects and worktrees keep their original filesystem paths, and provider-owned
session files stay in their original CLI homes. Both clients can therefore edit
the same projects. Avoid running competing agents in the same checkout. A native
provider session that was active during the snapshot should be continued through
a new session or provider handoff rather than resumed concurrently in both clients.

## DeepSeek Harness

Install the official pinned CLI and configure the fork:

```powershell
npm install --global @deepseek-ai/dsh@0.2.2-rc.1
node scripts/fork/deepseek.mjs "$env:USERPROFILE\.g3code"
```

The instance appears as **DeepSeek Harness** and uses the existing ACP adapter.
On Windows it runs `node.exe` with the installed CLI script and separate
`--profile`, `acp` arguments. Models and reasoning options come from the harness.
Configure credentials in the harness. `dsh web` opens its standalone interface
for setup and direct use.

### Use OpenCode Go

The installed setup uses your Go key through DSH's built-in `opencode-go` route.
DeepSeek V4.1 Flash is the default, and V4 Pro is also available. The route sends
Go's required session header for each DSH conversation. The key is stored in the
fork home's private directory with a user-only ACL on Windows. It is loaded into
the DSH process environment and stays outside settings and Git.

To configure another installation, supply its key through the private secret card,
then pass that file path locally:

```powershell
node scripts/fork/deepseek.mjs "$env:USERPROFILE\.g3code" --go --key-file <private-key-file>
```

The `g3code-acp` and `g3code-web` DSH profiles isolate these defaults from the
ordinary DSH profiles. Launch standalone DSH with the configured Go account:

```powershell
node scripts/fork/dsh-launch.mjs "$env:USERPROFILE\.g3code\private\dsh-runtime.json" --profile g3code-web
```

[OpenCode documents Go access from other harnesses](https://opencode.ai/docs/console/harnesses).
Its subscription limits apply to these requests.

Installation and protocol negotiation can be verified without a paid model turn.
Model execution requires the configured provider's account or API credentials.
Existing DSH sessions may resume model context without replaying their historical
transcripts through ACP. Threads created in T3 keep their own persisted transcript.
