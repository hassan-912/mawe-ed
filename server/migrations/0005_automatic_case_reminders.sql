-- Reminder enrollment is automatic for every case; appointment edits move it.
UPDATE records
SET payload=json_remove(payload,'$.reminderStart'),
    start_date=date(json_extract(payload,'$.appointment'),'-7 days'),
    last_scan=NULL,
    version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE type='cases';

UPDATE deliveries
SET status='cancelled',error='Automatic reminder schedule updated',
    dedup_key=dedup_key||':previous-start-rule'
WHERE status IN ('pending','failed','sending')
AND record_id IN (SELECT id FROM records WHERE type='cases');
