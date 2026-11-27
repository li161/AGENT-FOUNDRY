CREATE TABLE IF NOT EXISTS ppa_memories (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  content text NOT NULL,
  source text NOT NULL DEFAULT 'agent',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ppa_memories_user_updated
  ON ppa_memories(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ppa_tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ppa_tasks_user_updated
  ON ppa_tasks(user_id, updated_at DESC);
