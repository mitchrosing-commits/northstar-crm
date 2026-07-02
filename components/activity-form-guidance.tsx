export const activityManualFollowUpCopy =
  "Manual follow-up only. Due dates help sort work; they do not send reminders.";

export const activityDueDateHelpCopy = "Used for work-queue order, not calendar reminders.";

export function ActivityManualFollowUpHint() {
  return <p className="form-hint">{activityManualFollowUpCopy}</p>;
}

export function ActivityDueDateHint() {
  return <small className="form-hint">{activityDueDateHelpCopy}</small>;
}
