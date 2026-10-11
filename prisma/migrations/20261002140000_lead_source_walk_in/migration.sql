-- Walk-in enquiries are recorded through the canonical lead source.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WALK_IN';
