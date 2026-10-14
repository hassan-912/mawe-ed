-- Preserve existing administrators and process staff. Consultants use ordinary
-- employee accounts with a separate workflow, never administrator privileges.
ALTER TABLE users ADD COLUMN staff_type TEXT NOT NULL DEFAULT 'process'
  CHECK(staff_type IN ('process','consultant'));

-- Reindex default case starts; preserve explicitly chosen reminder dates.
UPDATE records
SET start_date = CASE
  WHEN COALESCE(json_extract(payload,'$.reminderStart'),'') != ''
    THEN json_extract(payload,'$.reminderStart')
  ELSE date(json_extract(payload,'$.appointment'),'-7 days')
END, last_scan = NULL
WHERE type = 'cases';

-- Replace queued messages from the previous countdown rules at the next scan.
UPDATE deliveries SET status='cancelled',error='Reminder rules updated',dedup_key=dedup_key||':previous-rules'
WHERE status IN ('pending','failed','sending')
AND record_id IN (SELECT id FROM records WHERE type='cases');
