CREATE TABLE personal_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX personal_tasks_user ON personal_tasks(user_id,updated_at);

-- One credit per work unit prevents repeated checkbox toggles earning points.
CREATE TABLE work_credits (
  credit_key TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('created','checklist','followup','task','handoff')),
  item TEXT NOT NULL DEFAULT '',
  work_day TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX work_credits_period ON work_credits(created_at,actor_id);

-- Recover checklist completions from the existing server-written history.
-- Checklist names are fixed by the app; match whole items, not substrings.
INSERT OR IGNORE INTO work_credits
SELECT record_id||':checklist:'||item,record_id,actor_id,'checklist',item,
       '',5,created_at
FROM (
  SELECT a.record_id,a.actor_id,k.key AS item,a.created_at,
    ROW_NUMBER() OVER(PARTITION BY a.record_id,k.key ORDER BY a.created_at,a.id) AS position
  FROM activity a JOIN records r ON r.id=a.record_id JOIN json_each(r.payload,'$.checks') k
  WHERE r.type='cases' AND a.actor_id IS NOT NULL AND a.action='record.updated' AND a.summary LIKE 'Completed: %'
    AND instr(', '||CASE WHEN instr(a.summary,' · ')>0 THEN substr(a.summary,12,instr(a.summary,' · ')-12) ELSE substr(a.summary,12) END||', ', ', '||k.key||', ')>0
) WHERE position=1;
