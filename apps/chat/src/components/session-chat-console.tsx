"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  SessionChatMessage,
  SessionChatThread,
  SessionChatTrace,
} from "../server/db";

type SessionChatConsoleProps = {
  threads: SessionChatThread[];
  messagesByThread: Record<string, SessionChatMessage[]>;
  tracesByMessage: Record<string, SessionChatTrace[]>;
};

async function postJson(url: string, payload: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as {
    error?: string;
    result?: { dispatchOk?: boolean; dispatchError?: string | null };
  };

  if (!response.ok) {
    throw new Error(json.error ?? "Request failed.");
  }

  return json;
}

export function SessionChatConsole({
  threads,
  messagesByThread,
  tracesByMessage,
}: SessionChatConsoleProps) {
  const router = useRouter();
  const [threadTitle, setThreadTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [busyAction, setBusyAction] = useState<"thread" | "message" | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    threads[0]?.id ?? null,
  );

  const activeMessages = useMemo(() => {
    if (!activeThreadId) {
      return [];
    }

    return messagesByThread[activeThreadId] ?? [];
  }, [activeThreadId, messagesByThread]);

  async function handleCreateThread() {
    setBusyAction("thread");
    setErrorMessage(null);

    try {
      await postJson("/api/threads", { title: threadTitle });
      setThreadTitle("");
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create thread.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSendMessage() {
    if (!activeThreadId) {
      setErrorMessage("Create a thread before sending a message.");
      return;
    }

    setBusyAction("message");
    setErrorMessage(null);

    try {
      const json = await postJson("/api/messages", {
        threadId: activeThreadId,
        role: "user",
        body: messageBody,
      });

      if (json.result?.dispatchOk === false) {
        setErrorMessage(
          json.result.dispatchError ??
            "Dispatch failed after local persistence.",
        );
      }

      setMessageBody("");
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create message.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="console-shell">
      <div className="console-sidebar-card">
        <div className="section-head">
          <div>
            <p className="section-kicker">Local session state</p>
            <h2>Threads</h2>
          </div>
          <span className="count-pill">{threads.length}</span>
        </div>

        <label className="field-label" htmlFor="thread-title">
          New thread title
        </label>
        <div className="input-row">
          <input
            id="thread-title"
            onChange={(event) => setThreadTitle(event.target.value)}
            placeholder="Cold-start probe"
            value={threadTitle}
          />
          <button
            disabled={busyAction !== null}
            onClick={() => void handleCreateThread()}
            type="button"
          >
            Create
          </button>
        </div>

        <div
          className="thread-list"
          role="tablist"
          aria-label="Session threads"
        >
          {threads.length === 0 ? (
            <p className="empty-copy">
              No threads yet. Create one to verify write paths.
            </p>
          ) : null}
          {threads.map((thread) => (
            <button
              aria-selected={activeThreadId === thread.id}
              className={
                activeThreadId === thread.id
                  ? "thread-item is-active"
                  : "thread-item"
              }
              key={thread.id}
              onClick={() => setActiveThreadId(thread.id)}
              role="tab"
              type="button"
            >
              <strong>{thread.title}</strong>
              <small>
                {thread.status} ·{" "}
                {new Date(thread.updatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </button>
          ))}
        </div>
      </div>

      <div className="console-main-card">
        <div className="section-head">
          <div>
            <p className="section-kicker">CRUD probe</p>
            <h2>{activeThreadId ? "Message timeline" : "No active thread"}</h2>
          </div>
          <span className="count-pill">{activeMessages.length}</span>
        </div>

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

        <div className="message-stack">
          {activeMessages.length === 0 ? (
            <p className="empty-copy">
              Messages now persist locally first, then try a direct OpenClaw
              responses dispatch using the shared gateway token.
            </p>
          ) : null}

          {activeMessages.map((message) => (
            <article className="message-card" key={message.id}>
              <div className="message-meta">
                <strong>{message.role}</strong>
                <span>{message.traceState}</span>
              </div>
              <p>{message.body}</p>
              <div className="message-trace-meta">
                <span>Correlation</span>
                <code>{message.correlationId}</code>
              </div>
              <div className="trace-stack">
                {(tracesByMessage[message.id] ?? []).map((trace) => (
                  <div className="trace-chip" key={trace.id}>
                    <strong>{trace.stage}</strong>
                    <span>{trace.source}</span>
                    {trace.detail ? <small>{trace.detail}</small> : null}
                  </div>
                ))}
              </div>
              <small>{new Date(message.createdAt).toLocaleString()}</small>
            </article>
          ))}
        </div>

        <label className="field-label" htmlFor="message-body">
          Add local message
        </label>
        <textarea
          id="message-body"
          onChange={(event) => setMessageBody(event.target.value)}
          placeholder="Write the first local probe message..."
          rows={4}
          value={messageBody}
        />
        <div className="composer-row">
          <p>
            Current mode: persist locally, then dispatch to `OpenClaw
            /v1/responses` when available.
          </p>
          <button
            disabled={busyAction !== null || !activeThreadId}
            onClick={() => void handleSendMessage()}
            type="button"
          >
            Save message
          </button>
        </div>
      </div>
    </section>
  );
}
