import { prisma } from "../lib/db/prisma";
import { ApiError } from "../lib/api/responses";
import { diagnoseGmailConnection } from "../lib/services/email-connection-service";

type CliOptions = {
  actorEmail: string;
  connectionRef?: string;
  jobRef?: string;
  workspace: string;
};

const requestedOptions = readCliOptions(process.argv.slice(2));

async function main(options: CliOptions) {
  const [user, workspace] = await Promise.all([
    prisma.user.findFirst({
      where: { email: options.actorEmail, deletedAt: null },
      select: { id: true }
    }),
    prisma.workspace.findFirst({
      where: { OR: [{ id: options.workspace }, { slug: options.workspace }], deletedAt: null },
      select: { id: true, slug: true }
    })
  ]);
  if (!user) {
    throw new ApiError("USER_NOT_FOUND", "Diagnostic actor user was not found.", 404);
  }
  if (!workspace) {
    throw new ApiError("WORKSPACE_NOT_FOUND", "Diagnostic workspace was not found.", 404);
  }

  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    select: { id: true }
  });
  if (!membership) {
    throw new ApiError("FORBIDDEN", "Diagnostic actor does not have access to the selected workspace.", 403);
  }

  const diagnostic = await diagnoseGmailConnection(
    { actorUserId: user.id, workspaceId: workspace.id },
    { connectionRef: options.connectionRef, jobRef: options.jobRef }
  );
  console.log(JSON.stringify({ workspace: workspace.slug, diagnostic }, null, 2));
}

function readCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    actorEmail: process.env.GMAIL_DIAGNOSTIC_ACTOR_EMAIL ?? process.env.DEV_ACTOR_EMAIL ?? "alex@example.test",
    connectionRef: process.env.GMAIL_DIAGNOSTIC_CONNECTION_REF,
    jobRef: process.env.GMAIL_DIAGNOSTIC_JOB_REF,
    workspace: process.env.GMAIL_DIAGNOSTIC_WORKSPACE ?? process.env.DEV_WORKSPACE_SLUG ?? "northstar-revenue"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor-email" && next) {
      options.actorEmail = next;
      index += 1;
    } else if (arg === "--workspace" && next) {
      options.workspace = next;
      index += 1;
    } else if (arg === "--connection-ref" && next) {
      options.connectionRef = next;
      index += 1;
    } else if (arg === "--job-ref" && next) {
      options.jobRef = next;
      index += 1;
    }
  }

  return options;
}

function safeDiagnosticRequest(options: CliOptions) {
  return {
    connectionRef: options.connectionRef ?? null,
    jobRef: options.jobRef ?? null,
    workspace: options.workspace
  };
}

main(requestedOptions)
  .catch((error) => {
    const safeError =
      error instanceof ApiError
        ? { code: error.code, message: error.message, status: error.status }
        : { code: "GMAIL_DIAGNOSTIC_FAILED", message: "Gmail diagnostic failed.", status: 500 };
    console.error(JSON.stringify({ error: safeError, request: safeDiagnosticRequest(requestedOptions) }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
