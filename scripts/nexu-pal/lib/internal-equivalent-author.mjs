function normalizeLogin(login) {
  if (typeof login !== "string") {
    return "";
  }

  return login.trim().toLowerCase();
}

export function isSentryAutomationAuthor(login) {
  return normalizeLogin(login) === "sentry[bot]";
}

export function isInternalEquivalentAuthor({
  isInternalAuthor,
  issueAuthorLogin,
}) {
  if (isInternalAuthor === true) {
    return true;
  }

  return isSentryAutomationAuthor(issueAuthorLogin);
}
