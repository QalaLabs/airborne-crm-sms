-- PNS Call enquiries are recorded through the canonical lead source.
-- VOICE_AGENT is also ensured here: the voice assistant writes it directly, but no earlier migration added it.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'VOICE_AGENT';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PNS_CALL';
