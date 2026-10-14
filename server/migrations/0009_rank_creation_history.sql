-- Include file creation and handoffs that were recorded before Rank existed.
INSERT OR IGNORE INTO work_credits
SELECT a.record_id||':created:',a.record_id,a.actor_id,'created','','',1,a.created_at
FROM activity a JOIN records r ON r.id=a.record_id
WHERE a.actor_id IS NOT NULL AND a.action='record.created' AND r.type IN ('cases','consultations')
ORDER BY a.created_at,a.id;

INSERT OR IGNORE INTO work_credits
SELECT a.record_id||':handoff:',a.record_id,a.actor_id,'handoff','','',3,a.created_at
FROM activity a JOIN records r ON r.id=a.record_id
WHERE a.actor_id IS NOT NULL AND a.action='case.received' AND r.type='cases'
ORDER BY a.created_at,a.id;
