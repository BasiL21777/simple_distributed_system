CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  service_name VARCHAR(100) NOT NULL,
  request_id UUID NULL,
  action VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure')),
  source VARCHAR(20) NOT NULL CHECK (source IN ('client', 'service')),
  details TEXT NULL
);

CREATE TABLE IF NOT EXISTS request_states (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id UUID NOT NULL,
  service_name VARCHAR(100) NOT NULL,
  state VARCHAR(30) NOT NULL CHECK (state IN ('RECEIVED', 'AUTHENTICATED', 'QUEUED', 'CONSUMED', 'PROCESSED', 'FAILED')),
  status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_request_states_request_id ON request_states(request_id);
