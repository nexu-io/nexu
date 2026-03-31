import { createTriagePlan } from "./triage-opened-engine.mjs";

const supportedTriageActions = new Set(["accepted", "declined", "duplicated"]);

const commandPattern = /^\/triage\s+(accepted|declined|duplicated)(?:\s|$)/i;

export function parseTriageCommand(commentBody) {
  if (typeof commentBody !== "string") {
    return null;
  }

  const trimmedBody = commentBody.trim();
  const match = trimmedBody.match(commandPattern);

  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase(),
    raw: trimmedBody,
  };
}

function buildCommentForAction(action) {
  switch (action) {
    case "accepted":
      return "Thanks for the report. We've accepted this issue into triage and will track it in planning.";
    case "declined":
      return "Thanks for the report. We're declining this issue for now, so we'll close it. If new context changes the impact, feel free to open a follow-up issue.";
    case "duplicated":
      return "Thanks for the report. We've confirmed this issue as a duplicate and will close it so follow-up stays on the primary thread.";
    default:
      return "";
  }
}

export function buildTriageCommandPlan(action) {
  if (!supportedTriageActions.has(action)) {
    throw new Error(`Unsupported triage action: ${action}`);
  }

  const plan = createTriagePlan();
  plan.labelsToAdd.push(`triage:${action}`);
  plan.commentsToAdd.push(buildCommentForAction(action));
  plan.labelsToRemove.push(
    "needs-triage",
    "needs-information",
    "triage:accepted",
    "triage:declined",
    "triage:duplicated",
  );

  if (action === "accepted") {
    plan.closeIssue = false;
    return plan;
  }

  plan.closeIssue = true;

  if (action === "duplicated") {
    plan.labelsToRemove.push("possible-duplicate");
  }

  return plan;
}
