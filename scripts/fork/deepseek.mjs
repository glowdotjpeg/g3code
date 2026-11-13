import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

const platform = Effect.runSync(Effect.service(HostProcess.Platform));
const home = process.argv[2];
if (!home) throw new Error("Usage: node scripts/fork/deepseek.mjs <fork-home>");
const npmRoot = (
  platform === "win32"
    ? NodeChildProcess.execFileSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", "npm root --global"],
        {
          encoding: "utf8",
        },
      )
    : NodeChildProcess.execFileSync("npm", ["root", "--global"], {
        encoding: "utf8",
      })
).trim();
const cli = NodePath.join(npmRoot, "@deepseek-ai", "dsh", "lib", "bin.js");
await NodeFSP.access(cli);
const userdata = NodePath.join(NodePath.resolve(home), "userdata");
await NodeFSP.mkdir(userdata, { recursive: true });
const settingsPath = NodePath.join(userdata, "settings.json");
const settings = await NodeFSP.readFile(settingsPath, "utf8").then(JSON.parse, () => ({}));
let commandArgs = [cli, "--profile", "acp"];
if (process.argv.includes("--go")) {
  const keyFile = process.argv[process.argv.indexOf("--key-file") + 1];
  if (!process.argv.includes("--key-file") || !keyFile)
    throw new Error("Supply --key-file using the private secret card.");
  const privateDirectory = NodePath.join(NodePath.resolve(home), "private");
  await NodeFSP.mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const storedKey = NodePath.join(privateDirectory, "opencode-go.key");
  await NodeFSP.writeFile(storedKey, (await NodeFSP.readFile(keyFile, "utf8")).trim(), {
    mode: 0o600,
  });
  if (platform === "win32")
    NodeChildProcess.execFileSync(
      "icacls",
      [
        storedKey,
        "/inheritance:r",
        "/grant:r",
        `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(R,W)`,
      ],
      { stdio: "ignore" },
    );
  const patch = `- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        displayName: OpenCode Go
        apiKeyEnv: OPENCODE_API_KEY
        api: openai-completions
        baseURL: https://opencode.ai/inference/go/openai/v1
        reasoning: high
        compat:
          thinkingFormat: deepseek
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash (Go)
            contextWindow: 1000000
            maxTokens: 384000
            input: [text, image]
            reasoningEfforts: {low: low, high: high, max: max}
          - id: deepseek-v4-pro
            name: DeepSeek V4 Pro (Go)
            contextWindow: 1000000
            maxTokens: 384000
            input: [text]
            reasoningEfforts: {high: high, max: max}
- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
    reasoningEffort: high
`;
  for (const [profile, template] of [
    ["g3code-acp", "acp"],
    ["g3code-web", "web"],
  ]) {
    NodeChildProcess.execFileSync(
      process.execPath,
      [cli, profile, "--from-default-profile", template, "--help"],
      {
        stdio: "ignore",
      },
    );
    const profileDirectory = NodePath.join(
      process.env.DSH_HOME ?? NodePath.join(NodeOS.homedir(), ".dsh"),
      "profiles",
      profile,
    );
    await NodeFSP.writeFile(
      NodePath.join(profileDirectory, "cordis.patch.yml"),
      patch +
        (template === "acp"
          ? "- id: acp\n  config:\n    provider: opencode-go\n    model: deepseek-v4.1-flash\n"
          : ""),
    );
  }
  const runtimeConfig = NodePath.join(privateDirectory, "dsh-runtime.json");
  await NodeFSP.writeFile(
    runtimeConfig,
    JSON.stringify({ cli, keyFile: storedKey }, null, 2) + "\n",
  );
  commandArgs = [
    NodeURL.fileURLToPath(new URL("./dsh-launch.mjs", import.meta.url)),
    runtimeConfig,
    "--profile",
    "g3code-acp",
  ];
}
settings.providerInstances ??= {};
settings.providerInstances.deepseek = {
  driver: "acpRegistry",
  displayName: "DeepSeek Harness",
  enabled: true,
  config: {
    source: "local",
    commandPath: process.execPath,
    commandArgs,
  },
};
await NodeFSP.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`Configured DeepSeek Harness in ${settingsPath}`);
