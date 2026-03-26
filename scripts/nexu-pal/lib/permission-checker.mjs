import { fetchWithTimeout } from "./github-client.mjs";

export async function getCollaboratorPermission({ token, repo, username }) {
  if (!token || !repo || !username) {
    throw new Error(
      "getCollaboratorPermission requires token, repo, and username",
    );
  }

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(username)}/permission`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (response.status === 404) {
    return "none";
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub collaborator permission lookup failed (${response.status}): ${text}`,
    );
  }

  const data = await response.json();
  return typeof data.permission === "string" ? data.permission : "none";
}

export function canExecuteTriageCommand(permission) {
  return permission === "write" || permission === "admin";
}
