-- SCTMG Data Disc: accounts, synced rosters, roster share links, online games.
-- Apply with: npx wrangler d1 migrations apply DB --remote

-- One row per Discord account that has signed in. We keep only what the app
-- shows: Discord's user ID, display name and avatar hash. No email.
CREATE TABLE users (
  id         TEXT PRIMARY KEY,          -- our own random ID
  discord_id TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  avatar     TEXT,                      -- Discord avatar hash, may be NULL
  created    INTEGER NOT NULL,          -- ms since epoch
  seen       INTEGER NOT NULL
);

-- Sign-in sessions. The cookie holds a random token; we store only its SHA-256.
CREATE TABLE sessions (
  hash     TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Saved rosters, one row per roster. data is the roster JSON from the app.
-- deleted=1 is a tombstone, so a delete on one device reaches the others.
CREATE TABLE rosters (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id       TEXT NOT NULL,
  data     TEXT,
  updated  INTEGER NOT NULL,
  deleted  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

-- Read-only roster snapshots behind a share link (/#share=CODE).
CREATE TABLE shares (
  code     TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data     TEXT NOT NULL,
  created  INTEGER NOT NULL
);

-- Online games. state is the shared game JSON; version goes up on every change
-- so clients can poll cheaply and writes can't overwrite each other.
CREATE TABLE games (
  code     TEXT PRIMARY KEY,
  host     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest    TEXT REFERENCES users(id) ON DELETE CASCADE,
  status   TEXT NOT NULL DEFAULT 'active',   -- active | ended
  state    TEXT NOT NULL,
  version  INTEGER NOT NULL DEFAULT 1,
  created  INTEGER NOT NULL,
  updated  INTEGER NOT NULL
);
CREATE INDEX games_host ON games(host, updated);
CREATE INDEX games_guest ON games(guest, updated);
