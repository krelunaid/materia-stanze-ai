CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, client_hash, route)
);

CREATE INDEX IF NOT EXISTS idx_ai_rate_limits_updated_at
ON ai_rate_limits(updated_at);
