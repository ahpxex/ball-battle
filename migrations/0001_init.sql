-- Everyone who plays online is a user: guests are created on first online visit
-- and become "registered" once linked to a GitHub/Google identity.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  registered INTEGER NOT NULL DEFAULT 0,
  -- Short code others type to send a friend request (registered users only).
  friend_code TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_user ON identities(user_id);

-- Only a SHA-256 of the session token is stored; the token lives in an HttpOnly cookie.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A request is one 'pending' row (requester -> target). Accepting turns it into
-- two 'accepted' rows, one per direction, so "my friends" is a single lookup.
CREATE TABLE friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX friendships_friend ON friendships(friend_id, status);

-- One finished online series (a single round in 暗选单局, up to three in 三局两胜).
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  mode TEXT NOT NULL,
  p0 TEXT NOT NULL REFERENCES users(id),
  p1 TEXT NOT NULL REFERENCES users(id),
  score0 INTEGER NOT NULL,
  score1 INTEGER NOT NULL,
  winner INTEGER NOT NULL,
  forfeit INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE INDEX series_p0 ON series(p0, ended_at);
CREATE INDEX series_p1 ON series(p1, ended_at);

CREATE TABLE rounds (
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  left_char TEXT NOT NULL,
  right_char TEXT NOT NULL,
  seed INTEGER NOT NULL,
  winner INTEGER,
  fight_time REAL NOT NULL,
  PRIMARY KEY (series_id, idx)
);
