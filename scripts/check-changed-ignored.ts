// @effect-diagnostics nodeBuiltinImport:off - dirents distinguish Windows junctions from directories.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
export async function ignoredCheckInputs(root: string, entries: readonly string[]) {
  const files: string[] = [];
  const matches = (file: string) =>
    /(^|\/)\.(?:generated|astro)\//.test(file) ||
    /\.d\.ts$/.test(file) ||
    /(^|\/)\.env[^/]*$/.test(file);
  const visit = async (directory: string) => {
    for (const entry of await NodeFSP.readdir(NodePath.join(root, directory), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink() || entry.name === "node_modules" || entry.name === ".git")
        continue;
      const relative = `${directory.replace(/\/$/, "")}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if (matches(relative)) files.push(relative);
    }
  };
  for (const entry of entries) {
    if (entry.split("/").includes("node_modules")) continue;
    if (entry.endsWith("/")) {
      if (!(await NodeFSP.lstat(NodePath.join(root, entry))).isSymbolicLink()) await visit(entry);
    } else if (matches(entry)) files.push(entry);
  }
  return files.sort();
}
