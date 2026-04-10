CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  qr_image TEXT,
  payment_method TEXT DEFAULT 'qris',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_status ON deposits(status);