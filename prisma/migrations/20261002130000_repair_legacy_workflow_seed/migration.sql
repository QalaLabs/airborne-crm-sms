-- Repairs the demo "new-lead-welcome" workflow written by an old prisma/seed.ts.
-- Its triggerConditions used a pre-engine shape ({"source": ...}) with no
-- field/op, which crashed lead/created matching. Only rows that still hold the
-- exact legacy JSON are touched, so admin-edited workflows are left alone.

UPDATE "workflows"
SET "triggerConditions" = '{"field": "source", "op": "eq", "value": "FACEBOOK_ADS"}'::jsonb,
    "updatedAt" = NOW()
WHERE "code" = 'new-lead-welcome'
  AND "triggerConditions" = '{"source": "FACEBOOK_ADS"}'::jsonb;

UPDATE "workflows"
SET "steps" = '[{"name": "Welcome on WhatsApp", "type": "SEND_WHATSAPP", "variables": {"message": "Hi {{leadName}}, welcome to Airborne Aviation! A counsellor will call you shortly."}}]'::jsonb,
    "updatedAt" = NOW()
WHERE "code" = 'new-lead-welcome'
  AND "steps" = '[{"type": "SEND_WHATSAPP", "templateCode": "new-lead-welcome"}]'::jsonb;
