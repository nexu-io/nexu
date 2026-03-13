alter table session_chat_messages
  add column if not exists correlation_id text not null default '';

create table if not exists session_chat_traces (
  id text primary key,
  message_id text not null,
  correlation_id text not null,
  stage text not null,
  source text not null,
  detail text,
  created_at text not null
);

create index if not exists session_chat_traces_message_created_idx
  on session_chat_traces (message_id, created_at);

create index if not exists session_chat_traces_correlation_created_idx
  on session_chat_traces (correlation_id, created_at);

update session_chat_messages
set correlation_id = id
where correlation_id = '';
