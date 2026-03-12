-- Seed 3 new Google Workspace toolkits: Meet, Slides, Tasks
-- Run via: psql $DATABASE_URL -f apps/api/src/scripts/seed-google-toolkits.sql
-- Or via MCP: pg_execute_mutation

INSERT INTO supported_toolkits (id, slug, display_name, description, domain, category, auth_scheme, enabled, sort_order, created_at, updated_at)
VALUES
  ('tk_googlemeet',    'google-meet',   'Google Meet',   'Create meeting spaces, manage recordings, retrieve transcripts, and view participant details in Google Meet.', 'meet.google.com',   'communication', 'oauth2', true, 27, NOW()::text, NOW()::text),
  ('tk_googleslides',  'google-slides', 'Google Slides', 'Create, read, and update Google Slides presentations. Generate slides from markdown.',                        'slides.google.com', 'office',        'oauth2', true, 28, NOW()::text, NOW()::text),
  ('tk_googletasks',   'google-tasks',  'Google Tasks',  'Create, read, update, and manage task lists and tasks in Google Tasks.',                                       'tasks.google.com',  'office',        'oauth2', true, 29, NOW()::text, NOW()::text)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  domain       = EXCLUDED.domain,
  category     = EXCLUDED.category,
  auth_scheme  = EXCLUDED.auth_scheme,
  enabled      = EXCLUDED.enabled,
  updated_at   = NOW()::text;

-- Seed skill catalog entries (supported_skills — powers the Skills page)
INSERT INTO supported_skills (id, slug, name, description, long_description, icon_name, prompt, examples, tag, source, toolkit_slugs, enabled, sort_order, created_at, updated_at)
VALUES
  ('sk_google_meet',   'google-meet',   'Google Meet',   'Video meetings, recordings and transcripts',  'Once connected to Google Meet, Nexu can help you create meeting spaces, access recordings and transcripts, and view participant details.',    'Video',   'Help me create a Google Meet meeting for [topic]',    '["Help me create a new Google Meet space","Help me get the recording from yesterday''s meeting","Help me list participants from the last team standup"]', 'office-collab',  'official', '["googlemeet"]',    true, 61, NOW()::text, NOW()::text),
  ('sk_google_slides', 'google-slides', 'Google Slides', 'Presentation creation and editing',           'Once connected to Google Slides, Nexu can help you create, edit and manage presentations, generate slides from markdown, and export thumbnails.', 'PenTool', 'Help me create a presentation about [topic]',         '["Help me create a new presentation about Q1 results","Help me generate slides from this markdown","Help me get a thumbnail of slide 3"]',                'file-knowledge', 'official', '["googleslides"]',  true, 62, NOW()::text, NOW()::text),
  ('sk_google_tasks',  'google-tasks',  'Google Tasks',  'Task list and to-do management',              'Once connected to Google Tasks, Nexu can help you create, update and manage task lists and individual tasks to stay organized.',                  'Check',   'Help me create a task list for [project]',            '["Help me create a new task list for the sprint","Help me add a task to follow up with the client","Help me show all my pending tasks"]',                  'office-collab',  'official', '["googletasks"]',   true, 63, NOW()::text, NOW()::text)
ON CONFLICT (slug) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  icon_name        = EXCLUDED.icon_name,
  prompt           = EXCLUDED.prompt,
  examples         = EXCLUDED.examples,
  tag              = EXCLUDED.tag,
  toolkit_slugs    = EXCLUDED.toolkit_slugs,
  enabled          = EXCLUDED.enabled,
  updated_at       = NOW()::text;
