import { Badge } from "@/components/badge";
import type { EmailSyncHealth } from "@/lib/services/email-connection-service";

type GmailSyncHealthDetailsProps = {
  health: EmailSyncHealth;
};

export function GmailSyncHealthDetails({ health }: GmailSyncHealthDetailsProps) {
  return (
    <details className="gmail-sync-health">
      <summary>
        <span>Sync history and health</span>
        <Badge className={`badge gmail-sync-health-badge gmail-sync-health-${health.currentStateTone}`}>
          {health.currentStateLabel}
        </Badge>
      </summary>
      <div className="gmail-sync-health-body">
        <p>{health.currentStateDetail}</p>
        {health.recoveryDetail ? (
          <p className="form-hint">{health.recoveryDetail}</p>
        ) : null}
        {health.activeDuplicateMessage ? (
          <p className="form-hint">{health.activeDuplicateMessage}</p>
        ) : null}
        {health.staleWorkerDetail ? (
          <p className="form-hint gmail-sync-health-warning">
            {health.staleWorkerDetail}
          </p>
        ) : null}
        <dl className="gmail-sync-health-grid">
          <SyncHealthFact
            label="Last attempt"
            value={formatSyncDateTime(health.lastAttemptedAt)}
          />
          <SyncHealthFact
            label="Last success"
            value={formatSyncDateTime(health.lastSuccessfulAt)}
          />
          <SyncHealthFact
            label="Next automatic sync"
            value={formatSyncDateTime(health.nextAutoSyncEligibleAt)}
          />
          <SyncHealthFact
            label="Retry timing"
            value={formatSyncDateTime(health.retryAt)}
          />
          <SyncHealthFact
            label="Latest mode"
            value={syncModeLabel(health.syncCounts.mode)}
          />
          <SyncHealthFact
            label="Latest source"
            value={health.latestJobSourceLabel ?? "No job yet"}
          />
          <SyncHealthFact
            label="Failure category"
            value={health.failureCategory ?? "None"}
          />
          <SyncHealthFact
            label="Recovery"
            value={syncRecoveryLabel(health.recoveryAction)}
          />
        </dl>
        <div className="gmail-sync-health-counts" aria-label="Latest Gmail sync result counts">
          <Badge>Fetched {health.syncCounts.fetched ?? 0}</Badge>
          <Badge>Imported {health.syncCounts.imported ?? 0}</Badge>
          <Badge>Duplicates {health.syncCounts.duplicates ?? 0}</Badge>
          <Badge>Skipped {(health.syncCounts.skipped ?? 0) + (health.syncCounts.skippedMessages ?? 0)}</Badge>
        </div>
        {health.lastError ? (
          <p className="form-hint">Safe latest issue: {health.lastError}</p>
        ) : null}
        {health.recentJobs.length > 0 ? (
          <div className="gmail-sync-health-history">
            <strong>Recent attempts</strong>
            <ul>
              {health.recentJobs.map((job) => (
                <li key={job.jobRef}>
                  <span>
                    {job.statusLabel} · {job.sourceLabel} · {job.jobRef}
                  </span>
                  <span>
                    Updated {formatSyncDateTime(job.updatedAt)}
                    {job.nextRunAt
                      ? ` · next run ${formatSyncDateTime(job.nextRunAt)}`
                      : ""}
                    {job.completedAt
                      ? ` · completed ${formatSyncDateTime(job.completedAt)}`
                      : ""}
                  </span>
                  {job.lastError ? (
                    <span>Safe issue: {job.lastError}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="form-hint">No Gmail sync job history is available yet.</p>
        )}
      </div>
    </details>
  );
}

function SyncHealthFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatSyncDateTime(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return `${relativeDateTime(date)} (${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)})`;
}

function relativeDateTime(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units = [
    { ms: 24 * 60 * 60 * 1000, name: "day" },
    { ms: 60 * 60 * 1000, name: "hour" },
    { ms: 60 * 1000, name: "minute" },
  ] as const;
  for (const unit of units) {
    if (absMs >= unit.ms) {
      const value = Math.round(diffMs / unit.ms);
      return new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(
        value,
        unit.name,
      );
    }
  }
  return "now";
}

function syncModeLabel(mode: string | null) {
  if (mode === "older") return "Load older";
  if (mode === "thread") return "Thread refresh";
  if (mode === "recent") return "Inbox sync";
  return "No completed sync";
}

function syncRecoveryLabel(action: EmailSyncHealth["recoveryAction"]) {
  if (action === "reconnect_gmail") return "Reconnect Gmail";
  if (action === "retry_now") return "Retry now available";
  if (action === "wait") return "Wait for queued retry";
  return "None";
}
