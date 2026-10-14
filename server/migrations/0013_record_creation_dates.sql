ALTER TABLE records ADD COLUMN created_at TEXT;
UPDATE records SET created_at=COALESCE(
  (SELECT json_extract(value,'$.rawValue') FROM json_each(records.payload,'$.sheetDetails') WHERE json_extract(value,'$.sourceLabel')='Timestamp' LIMIT 1),
  (SELECT created_at FROM activity WHERE record_id=records.id AND action IN ('record.created','case.received') ORDER BY created_at,id LIMIT 1)
);
