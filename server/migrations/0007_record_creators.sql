-- Preserve the person who created each file independently of its assignment.
ALTER TABLE records ADD COLUMN creator_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE records ADD COLUMN creator_name TEXT;

-- Only creation events establish authorship. Do not assume the current owner
-- created legacy records whose creation history is unavailable.
UPDATE records SET
  creator_id=(SELECT actor_id FROM activity WHERE record_id=records.id AND action IN ('record.created','case.received') ORDER BY created_at,id LIMIT 1),
  creator_name=(SELECT actor_name FROM activity WHERE record_id=records.id AND action IN ('record.created','case.received') ORDER BY created_at,id LIMIT 1);
