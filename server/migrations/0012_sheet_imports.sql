CREATE TABLE sheet_import_rows (
  source_id TEXT NOT NULL,
  sheet_row INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  record_id TEXT NOT NULL UNIQUE REFERENCES records(id),
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source_id,sheet_row)
);
