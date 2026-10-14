-- Keep the creator's email independent of later assignments.
ALTER TABLE records ADD COLUMN creator_email TEXT;
UPDATE records SET creator_email=(SELECT email FROM users WHERE users.id=records.creator_id)
WHERE creator_id IS NOT NULL;
