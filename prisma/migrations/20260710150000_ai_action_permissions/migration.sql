ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "aiActionPermissionDefaults" JSONB;

ALTER TABLE "AiPreference"
  ADD COLUMN IF NOT EXISTS "assistantActionPermissions" JSONB;

ALTER TABLE "AiPreference"
  DROP COLUMN IF EXISTS "assistantPermissionMode";
