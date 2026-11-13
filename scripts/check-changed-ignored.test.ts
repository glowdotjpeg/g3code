// @effect-diagnostics nodeBuiltinImport:off - constructs a real Windows junction fixture.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { ignoredCheckInputs } from "./check-changed-ignored.ts";
it("finds generated inputs without following pnpm junction cycles", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ignored-inputs-"));
  try {
    await NodeFSP.mkdir(NodePath.join(root, ".generated"));
    await NodeFSP.mkdir(NodePath.join(root, "node_modules"));
    await NodeFSP.writeFile(NodePath.join(root, ".generated", "schema.ts"), "export {};");
    await NodeFSP.writeFile(NodePath.join(root, ".generated", "types.d.ts"), "export {};");
    await NodeFSP.writeFile(NodePath.join(root, ".env.local"), "TEST=1");
    await NodeFSP.symlink(root, NodePath.join(root, ".generated", "cycle"), "junction");
    expect(await ignoredCheckInputs(root, ["node_modules/", ".generated/", ".env.local"])).toEqual([
      ".env.local",
      ".generated/schema.ts",
      ".generated/types.d.ts",
    ]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
