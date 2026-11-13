import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
const configPath = process.argv[2];
if (!configPath) throw new Error("Pass the private DSH runtime configuration path.");
const config = JSON.parse(await NodeFSP.readFile(configPath, "utf8"));
process.env.OPENCODE_API_KEY = (await NodeFSP.readFile(config.keyFile, "utf8")).trim();
process.argv = [process.execPath, config.cli, ...process.argv.slice(3)];
const { runCli } = await import(NodeURL.pathToFileURL(config.cli).href);
await runCli();
