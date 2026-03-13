create table if not exists session_chat_migrations (
  name text primary key,
  applied_at text not null
);

create table if not exists session_chat_threads (
  id text primary key,
  title text not null,
  status text not null default 'idle',
  created_at text not null,
  updated_at text not null
);

create table if not exists session_chat_messages (
  id text primary key,
  thread_id text not null,
  role text not null,
  body text not null,
  trace_state text not null default 'cold-start',
  created_at text not null
);

create index if not exists session_chat_messages_thread_created_idx
  on session_chat_messages (thread_id, created_at);
