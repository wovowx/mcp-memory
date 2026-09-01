-- Common Ground Phase 1: minimal atomic event claim
-- Apply once to the database used by mcp-memory.
ALTER TABLE chat_agent_events
ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- No attempts/last_error/queue fields are introduced in Phase 1.
-- claimed_at is only claim metadata; it is not by itself a crash-recovery lease.