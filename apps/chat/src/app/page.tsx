import { SessionChatConsole } from "../components/session-chat-console";
import {
  type SessionChatMessage,
  type SessionChatTrace,
  bootstrapSessionChatDatabase,
  getSessionChatDatabaseUrl,
  listSessionChatMessages,
  listSessionChatThreads,
  listSessionChatTraces,
  querySessionChat,
} from "../server/db";

export const dynamic = "force-dynamic";

const checks = [
  "Next.js sidecar booted inside Electron runtime",
  "Independent surface available from desktop sidebar",
  "Dedicated PGlite-backed database scaffold is live",
];

type BootstrapStatus = {
  migrationCount: number;
  threadCount: number;
  messageCount: number;
  databaseUrl: string;
};

async function getBootstrapStatus(): Promise<BootstrapStatus> {
  await bootstrapSessionChatDatabase();

  const [{ count: migrationCount }] = await querySessionChat<{ count: string }>(
    "select count(*)::text as count from session_chat_migrations",
  );
  const [{ count: threadCount }] = await querySessionChat<{ count: string }>(
    "select count(*)::text as count from session_chat_threads",
  );
  const [{ count: messageCount }] = await querySessionChat<{ count: string }>(
    "select count(*)::text as count from session_chat_messages",
  );

  return {
    migrationCount: Number.parseInt(migrationCount, 10),
    threadCount: Number.parseInt(threadCount, 10),
    messageCount: Number.parseInt(messageCount, 10),
    databaseUrl: getSessionChatDatabaseUrl(),
  };
}

export default async function SessionChatHome() {
  const status = await getBootstrapStatus();
  const threads = await listSessionChatThreads();
  const messagesByThread: Record<string, SessionChatMessage[]> =
    Object.fromEntries(
      await Promise.all(
        threads.map(async (thread) => [
          thread.id,
          await listSessionChatMessages(thread.id),
        ]),
      ),
    );
  const allMessages = Object.values(messagesByThread).flat();
  const tracesByMessage: Record<string, SessionChatTrace[]> =
    Object.fromEntries(
      await Promise.all(
        allMessages.map(async (message) => [
          message.id,
          await listSessionChatTraces(message.id),
        ]),
      ),
    );

  return (
    <main className="shell">
      <section className="hero-card">
        <p className="eyebrow">Session Chat Sidecar</p>
        <h1>Cold start is live.</h1>
        <p className="lede">
          This surface exists only to prove the standalone Next.js sidecar can
          boot cleanly under the local desktop orchestrator, with its own
          dedicated PGlite backend, before we wire real OpenClaw channel
          traffic.
        </p>
        <div className="status-row">
          <span className="status-dot" />
          <strong>Ready for channel integration</strong>
        </div>
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>Current scope</h2>
          <ul>
            {checks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="detail-card">
          <h2>Runtime hints</h2>
          <dl>
            <div>
              <dt>Surface</dt>
              <dd>Session Chat</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>Standalone Next.js sidecar</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>PGlite socket sidecar on a dedicated port</dd>
            </div>
            <div>
              <dt>Intent</dt>
              <dd>Cold-start validation first, channel flow second</dd>
            </div>
          </dl>
        </article>

        <article className="detail-card">
          <h2>Database status</h2>
          <dl>
            <div>
              <dt>Connection</dt>
              <dd>{status.databaseUrl}</dd>
            </div>
            <div>
              <dt>Migrations</dt>
              <dd>{status.migrationCount}</dd>
            </div>
            <div>
              <dt>Threads</dt>
              <dd>{status.threadCount}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{status.messageCount}</dd>
            </div>
          </dl>
        </article>
      </section>

      <SessionChatConsole
        messagesByThread={messagesByThread}
        threads={threads}
        tracesByMessage={tracesByMessage}
      />
    </main>
  );
}
