-- Optional usernames supplement email sign-in without changing existing accounts.
ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX users_username ON users(username);
