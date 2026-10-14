-- A file is complete only after it has also been submitted to review.
-- Preserve all existing preparation progress; start the new step unchecked.
UPDATE records SET
  payload=json_set(payload,'$.checks."Submitted to review"',json('false')),
  active=CASE WHEN COALESCE(json_extract(payload,'$.archived'),0)=0 THEN 1 ELSE 0 END,
  version=version+1,last_scan=NULL
WHERE type='cases' AND json_extract(payload,'$.kind') IN ('schengen_tourism','schengen_business','usa')
  AND json_type(payload,'$.checks."Submitted to review"') IS NULL;

UPDATE deliveries SET status='cancelled',error='Case review checklist updated'
WHERE status IN ('pending','failed','sending') AND record_id IN (
  SELECT id FROM records WHERE type='cases' AND json_extract(payload,'$.kind') IN ('schengen_tourism','schengen_business','usa')
);
