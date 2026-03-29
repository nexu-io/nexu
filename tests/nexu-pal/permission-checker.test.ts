import { describe, expect, it } from "vitest";
import { canExecuteTriageCommand } from "../../scripts/nexu-pal/lib/permission-checker.mjs";

describe("canExecuteTriageCommand", () => {
  it("allows write and admin permissions only", () => {
    expect(canExecuteTriageCommand("write")).toBe(true);
    expect(canExecuteTriageCommand("admin")).toBe(true);
    expect(canExecuteTriageCommand("read")).toBe(false);
    expect(canExecuteTriageCommand("triage")).toBe(false);
    expect(canExecuteTriageCommand("none")).toBe(false);
  });
});
