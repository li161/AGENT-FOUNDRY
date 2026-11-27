-- Idempotency key for at-least-once delivery from offline device outboxes.
ALTER TABLE ppa_sync_changes ADD COLUMN IF NOT EXISTS client_change_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ppa_sync_changes_idempotency
  ON ppa_sync_changes(user_id, client_change_id)
  WHERE client_change_id IS NOT NULL;
