const FETCH_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url,
  options,
  timeoutMs = FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createGitHubIssueClient({ token, repo, issueNumber }) {
  if (!token || !repo || !issueNumber) {
    throw new Error(
      "createGitHubIssueClient requires token, repo, and issueNumber",
    );
  }

  async function ghApi(path, method = "GET", body = undefined) {
    const url = `https://api.github.com/repos/${repo}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchWithTimeout(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `GitHub API ${method} ${path} failed (${response.status}): ${text}`,
      );
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  return {
    addComment(body) {
      return ghApi(`/issues/${issueNumber}/comments`, "POST", { body });
    },

    addLabel(label) {
      return ghApi(`/issues/${issueNumber}/labels`, "POST", {
        labels: [label],
      });
    },

    async applyPlan(plan) {
      for (const comment of plan.commentsToAdd) {
        await this.addComment(comment);
      }

      for (const label of plan.labelsToAdd) {
        await this.addLabel(label);
      }
    },
  };
}
