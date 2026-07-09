ALTER TABLE "AiPreference"
  ADD COLUMN "assistantNamePreset" TEXT NOT NULL DEFAULT 'Stella',
  ADD COLUMN "assistantCustomName" TEXT,
  ADD COLUMN "assistantTonePreset" TEXT NOT NULL DEFAULT 'warm_helpful',
  ADD COLUMN "assistantHelpAreas" TEXT,
  ADD COLUMN "assistantPermissionMode" TEXT NOT NULL DEFAULT 'review_first',
  ADD COLUMN "onboardingGoals" TEXT;
