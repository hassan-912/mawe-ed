ALTER TABLE users ADD COLUMN profile_photo_version TEXT;
CREATE TABLE profile_photos (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
  image BLOB NOT NULL CHECK(length(image)>0 AND length(image)<=131072),
  updated_at TEXT NOT NULL
);
