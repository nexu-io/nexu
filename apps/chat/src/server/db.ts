import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type QueryResultRow } from "pg";

export type SessionChatThread = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionChatMessage = {
  id: string;
  threadId: string;
  role: string;
  body: string;
  correlationId: string;
  traceState: string;
  createdAt: string;
};

export type SessionChatTrace = {
  id: string;
  messageId: string;
  correlationId: string;
  stage: string;
  source: string;
  detail: string | null;
  createdAt: string;
};

type SessionChatThreadRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type SessionChatMessageRow = {
  id: string;
  thread_id: string;
  role: string;
  body: string;
  correlation_id: string;
  trace_state: string;
  created_at: string;
};

type SessionChatTraceRow = {
  id: string;
  message_id: string;
  correlation_id: string;
  stage: string;
  source: string;
  detail: string | null;
  created_at: string;
};

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:50822/postgres?sslmode=disable";
const migrationsDir =
  process.env.SESSION_CHAT_MIGRATIONS_DIR ?? join(process.cwd(), "migrations");

declare global {
  var __sessionChatPool: Pool | undefined;
  var __sessionChatBootstrapPromise: Promise<void> | undefined;
}

const pool =
  globalThis.__sessionChatPool ?? new Pool({ connectionString: databaseUrl });

if (!globalThis.__sessionChatPool) {
  globalThis.__sessionChatPool = pool;
}

async function ensureBootstrap(): Promise<void> {
  await pool.query(`
    create table if not exists session_chat_migrations (
      name text primary key,
      applied_at text not null
    )
  `);

  const appliedRows = await pool.query<{ name: string }>(
    "select name from session_chat_migrations order by name asc",
  );
  const applied = new Set(appliedRows.rows.map((row) => row.name));
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    await pool.query("begin");

    try {
      await pool.query(sql);
      await pool.query(
        "insert into session_chat_migrations (name, applied_at) values ($1, $2)",
        [file, new Date().toISOString()],
      );
      await pool.query("commit");
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
  }
}

export async function bootstrapSessionChatDatabase(): Promise<void> {
  const existing = globalThis.__sessionChatBootstrapPromise;

  if (existing) {
    return existing;
  }

  const nextPromise = ensureBootstrap();
  globalThis.__sessionChatBootstrapPromise = nextPromise;

  try {
    await nextPromise;
  } catch (error) {
    globalThis.__sessionChatBootstrapPromise = undefined;
    throw error;
  }
}

export async function querySessionChat<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await bootstrapSessionChatDatabase();
  const result = await pool.query<T>(sql, values);
  return result.rows;
}

export function getSessionChatDatabaseUrl(): string {
  return databaseUrl;
}

function mapThread(row: SessionChatThreadRow): SessionChatThread {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: SessionChatMessageRow): SessionChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    body: row.body,
    correlationId: row.correlation_id,
    traceState: row.trace_state,
    createdAt: row.created_at,
  };
}

function mapTrace(row: SessionChatTraceRow): SessionChatTrace {
  return {
    id: row.id,
    messageId: row.message_id,
    correlationId: row.correlation_id,
    stage: row.stage,
    source: row.source,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export async function listSessionChatThreads(): Promise<SessionChatThread[]> {
  const rows = await querySessionChat<SessionChatThreadRow>(
    `select id, title, status, created_at, updated_at
     from session_chat_threads
     order by updated_at desc, created_at desc`,
  );

  return rows.map(mapThread);
}

export async function listSessionChatMessages(
  threadId: string,
): Promise<SessionChatMessage[]> {
  const rows = await querySessionChat<SessionChatMessageRow>(
    `select id, thread_id, role, body, correlation_id, trace_state, created_at
     from session_chat_messages
     where thread_id = $1
     order by created_at asc`,
    [threadId],
  );

  return rows.map(mapMessage);
}

export async function listSessionChatTraces(
  messageId: string,
): Promise<SessionChatTrace[]> {
  const rows = await querySessionChat<SessionChatTraceRow>(
    `select id, message_id, correlation_id, stage, source, detail, created_at
     from session_chat_traces
     where message_id = $1
     order by created_at asc`,
    [messageId],
  );

  return rows.map(mapTrace);
}

export async function createSessionChatThread(
  title: string,
): Promise<SessionChatThread> {
  const now = new Date().toISOString();
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error("Thread title is required.");
  }

  const rows = await querySessionChat<SessionChatThreadRow>(
    `insert into session_chat_threads (id, title, status, created_at, updated_at)
     values ($1, $2, 'idle', $3, $3)
     returning id, title, status, created_at, updated_at`,
    [randomUUID(), trimmedTitle, now],
  );

  return mapThread(rows[0]);
}

export async function createSessionChatMessage(input: {
  threadId: string;
  role: string;
  body: string;
}): Promise<SessionChatMessage> {
  const now = new Date().toISOString();
  const correlationId = randomUUID();
  const messageId = randomUUID();
  const trimmedBody = input.body.trim();

  if (!input.threadId.trim()) {
    throw new Error("Thread id is required.");
  }

  if (!trimmedBody) {
    throw new Error("Message body is required.");
  }

  const threadRows = await querySessionChat<{ id: string }>(
    "select id from session_chat_threads where id = $1 limit 1",
    [input.threadId],
  );

  if (threadRows.length === 0) {
    throw new Error("Thread not found.");
  }

  const rows = await querySessionChat<SessionChatMessageRow>(
    `insert into session_chat_messages (id, thread_id, role, body, correlation_id, trace_state, created_at)
     values ($1, $2, $3, $4, $5, 'persisted-local', $6)
     returning id, thread_id, role, body, correlation_id, trace_state, created_at`,
    [
      messageId,
      input.threadId,
      input.role.trim() || "user",
      trimmedBody,
      correlationId,
      now,
    ],
  );

  await recordSessionChatTrace({
    messageId,
    correlationId,
    stage: "submitted",
    source: "session-chat-ui",
    detail: "User submitted a local probe message.",
    createdAt: now,
  });

  await recordSessionChatTrace({
    messageId,
    correlationId,
    stage: "persisted",
    source: "session-chat-db",
    detail: "Message stored in dedicated session-chat database.",
    createdAt: now,
  });

  await querySessionChat(
    `update session_chat_threads
     set updated_at = $2,
         status = 'trace-ready'
     where id = $1`,
    [input.threadId, now],
  );

  return mapMessage(rows[0]);
}

async function recordSessionChatTrace(input: {
  messageId: string;
  correlationId: string;
  stage: string;
  source: string;
  detail: string;
  createdAt: string;
}): Promise<void> {
  await querySessionChat(
    `insert into session_chat_traces (id, message_id, correlation_id, stage, source, detail, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      input.messageId,
      input.correlationId,
      input.stage,
      input.source,
      input.detail,
      input.createdAt,
    ],
  );
}

export async function appendSessionChatMessage(input: {
  threadId: string;
  role: string;
  body: string;
  correlationId: string;
  traceState: string;
  createdAt?: string;
}): Promise<SessionChatMessage> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const rows = await querySessionChat<SessionChatMessageRow>(
    `insert into session_chat_messages (id, thread_id, role, body, correlation_id, trace_state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, thread_id, role, body, correlation_id, trace_state, created_at`,
    [
      randomUUID(),
      input.threadId,
      input.role,
      input.body,
      input.correlationId,
      input.traceState,
      createdAt,
    ],
  );

  return mapMessage(rows[0]);
}

export async function updateSessionChatMessageTraceState(
  messageId: string,
  traceState: string,
): Promise<void> {
  await querySessionChat(
    "update session_chat_messages set trace_state = $2 where id = $1",
    [messageId, traceState],
  );
}

export async function updateSessionChatThreadStatus(
  threadId: string,
  status: string,
): Promise<void> {
  await querySessionChat(
    `update session_chat_threads
     set status = $2,
         updated_at = $3
     where id = $1`,
    [threadId, status, new Date().toISOString()],
  );
}

export async function addSessionChatTrace(input: {
  messageId: string;
  correlationId: string;
  stage: string;
  source: string;
  detail: string;
  createdAt?: string;
}): Promise<void> {
  await recordSessionChatTrace({
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
