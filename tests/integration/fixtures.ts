import { ActivityType, MembershipRole, Prisma, PrismaClient } from "@prisma/client";

type IntegrationFixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

export async function createIntegrationFixture() {
  const prisma = await getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { recordsA, recordsB, userA, userB, workspaceA, workspaceB } = await prisma.$transaction(async (tx) => {
    const userA = await tx.user.create({
      data: { email: `integration-a-${suffix}@example.test`, name: "Integration A" }
    });
    const userB = await tx.user.create({
      data: { email: `integration-b-${suffix}@example.test`, name: "Integration B" }
    });

    const workspaceA = await tx.workspace.create({
      data: {
        name: `Integration A ${suffix}`,
        slug: `integration-a-${suffix}`,
        memberships: { create: { role: MembershipRole.OWNER, user: { connect: { id: userA.id } } } }
      }
    });

    const workspaceB = await tx.workspace.create({
      data: {
        name: `Integration B ${suffix}`,
        slug: `integration-b-${suffix}`,
        memberships: { create: { role: MembershipRole.OWNER, user: { connect: { id: userB.id } } } }
      }
    });

    const recordsA = await createWorkspaceGraph(tx, workspaceA.id, userA.id, "Alpha");
    const recordsB = await createWorkspaceGraph(tx, workspaceB.id, userB.id, "Beta");

    return { recordsA, recordsB, userA, userB, workspaceA, workspaceB };
  });

  return {
    prisma,
    userA,
    userB,
    workspaceA,
    workspaceB,
    actorA: { workspaceId: workspaceA.id, actorUserId: userA.id },
    actorB: { workspaceId: workspaceB.id, actorUserId: userB.id },
    recordsA,
    recordsB,
    cleanup: () => cleanupIntegrationFixture({ prisma, workspaceIds: [workspaceA.id, workspaceB.id], userIds: [userA.id, userB.id] })
  };
}

export async function cleanupIntegrationFixture({
  prisma,
  workspaceIds,
  userIds
}: {
  prisma: PrismaClient;
  workspaceIds: string[];
  userIds: string[];
}) {
  await prisma.job.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.meetingIntake.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.assistantActionRequest.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.savedView.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.goal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.customFieldValue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.customFieldDefinition.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.emailLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.emailTemplate.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.emailConnectionSecret.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.emailConnection.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.webFormSubmission.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.webForm.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.note.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.activity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.dealContractStep.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.quoteItem.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.quote.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.dealLineItem.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.deal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.person.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.organization.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.product.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.pipeline.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export async function getPrisma() {
  const { prisma } = await import("@/lib/db/prisma");
  return prisma;
}

async function createWorkspaceGraph(
  prisma: PrismaClient | Prisma.TransactionClient,
  workspaceId: string,
  ownerId: string,
  label: string
) {
  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId,
      name: `${label} Pipeline`,
      sortOrder: 1
    }
  });
  const [stageOne, stageTwo] = await Promise.all([
    prisma.pipelineStage.create({
      data: { workspaceId, pipelineId: pipeline.id, name: `${label} Qualified`, sortOrder: 1 }
    }),
    prisma.pipelineStage.create({
      data: { workspaceId, pipelineId: pipeline.id, name: `${label} Proposal`, sortOrder: 2 }
    })
  ]);
  const organization = await prisma.organization.create({
    data: {
      workspaceId,
      ownerId,
      name: `${label} Orbit Organization`,
      domain: `${label.toLowerCase()}-orbit.example`
    }
  });
  const person = await prisma.person.create({
    data: {
      workspaceId,
      ownerId,
      organizationId: organization.id,
      firstName: label,
      lastName: "Contact",
      email: `${label.toLowerCase()}@example.test`
    }
  });
  const deal = await prisma.deal.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: stageOne.id,
      ownerId,
      personId: person.id,
      organizationId: organization.id,
      title: `${label} Needle Deal`,
      valueCents: 123400,
      currency: "USD"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      ownerId,
      personId: person.id,
      organizationId: organization.id,
      title: `${label} Needle Lead`,
      source: `${label} source`
    }
  });
  const activity = await prisma.activity.create({
    data: {
      workspaceId,
      ownerId,
      leadId: lead.id,
      type: ActivityType.TASK,
      title: `${label} Needle Activity`,
      dueAt: new Date("2030-01-01T00:00:00.000Z")
    }
  });
  const note = await prisma.note.create({
    data: {
      workspaceId,
      authorId: ownerId,
      leadId: lead.id,
      body: `${label} needle note body`
    }
  });

  return { pipeline, stageOne, stageTwo, organization, person, deal, lead, activity, note };
}

export async function disconnectPrisma(fixture?: IntegrationFixture) {
  const prisma = fixture?.prisma ?? (await getPrisma());
  await prisma.$disconnect();
}
