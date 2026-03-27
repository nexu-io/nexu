import type { ChildProcess } from "node:child_process";

export async function waitForChildExit(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}
