-- Portable Personal Agent: durable conversations, execution traces and multi-device sync.
-- Apply after 001_init.sql. All timestamps are UTC timestamptz; IDs are client-generated UUIDs.

CREATE TABLE IF NOT EXISTS ppa_users (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ppa_devices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Unknown device',
  platform text NOT NULL DEFAULT 'unknown',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(user_id, id)
);
CREATE INDEX IF NOT EXISTS ppa_devices_user_seen ON ppa_devices(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS ppa_conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by_device_id text,
  updated_by_device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ppa_conversations_user_updated
  ON ppa_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ppa_messages (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES ppa_conversations(id) ON DELETE CASCADE,
  parent_message_id text REFERENCES ppa_messages(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('system','developer','user','assistant','tool')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending','streaming','completed','failed','interrupted')),
  model text,
  provider text,
  sequence_no bigint,
  version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_device_id text,
  updated_by_device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ppa_messages_conversation_order
  ON ppa_messages(user_id, conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS ppa_messages_user_updated
  ON ppa_messages(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ppa_messages_sequence_unique
  ON ppa_messages(conversation_id, sequence_no) WHERE sequence_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS ppa_message_parts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES ppa_messages(id) ON DELETE CASCADE,
  part_index integer NOT NULL,
  part_type text NOT NULL CHECK (part_type IN ('text','image','file','audio','video','tool_call','tool_result','citation','json')),
  content text,
  mime_type text,
  file_name text,
  file_path text,
  remote_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, part_index)
);
CREATE INDEX IF NOT EXISTS ppa_message_parts_message ON ppa_message_parts(message_id, part_index);

CREATE TABLE IF NOT EXISTS ppa_agent_runs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES ppa_conversations(id) ON DELETE CASCADE,
  trigger_message_id text REFERENCES ppa_messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting','completed','failed','cancelled','interrupted')),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ppa_agent_runs_recovery
  ON ppa_agent_runs(status, heartbeat_at) WHERE status IN ('queued','running','waiting');

CREATE TABLE IF NOT EXISTS ppa_model_calls (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  run_id text REFERENCES ppa_agent_runs(id) ON DELETE SET NULL,
  assistant_message_id text REFERENCES ppa_messages(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','streaming','completed','failed','interrupted')),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ppa_model_calls_user_created ON ppa_model_calls(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ppa_tool_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  run_id text REFERENCES ppa_agent_runs(id) ON DELETE CASCADE,
  message_id text REFERENCES ppa_messages(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ppa_tool_events_run ON ppa_tool_events(run_id, started_at);

-- Append-only change feed. The client stores its last applied cursor per account.
CREATE TABLE IF NOT EXISTS ppa_sync_changes (
  cursor bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','delete')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_device_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ppa_sync_changes_user_cursor ON ppa_sync_changes(user_id, cursor);

CREATE TABLE IF NOT EXISTS ppa_sync_cursors (
  user_id text NOT NULL REFERENCES ppa_users(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES ppa_devices(id) ON DELETE CASCADE,
  last_pulled_cursor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, device_id)
);

-- Recovery index: interrupted streaming replies and runs are discoverable after restart.
CREATE INDEX IF NOT EXISTS ppa_messages_incomplete
  ON ppa_messages(user_id, updated_at)
  WHERE status IN ('pending','streaming');
