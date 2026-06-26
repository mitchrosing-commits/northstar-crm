import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

const searchTake = 6;

export async function searchCrm(actor: WorkspaceActor, rawQuery: string) {
  await ensureWorkspaceAccess(actor);
  const query = rawQuery.trim();
  if (!query) {
    return {
      query,
      deals: [],
      leads: [],
      people: [],
      organizations: [],
      activities: [],
      notes: []
    };
  }

  const contains = { contains: query, mode: "insensitive" as const };
  const scoped = { workspaceId: actor.workspaceId, ...activeWhere };
  const [deals, leads, people, organizations, activities, notes] = await Promise.all([
    prisma.deal.findMany({
      where: { ...scoped, title: contains },
      include: { stage: true, organization: true, person: true },
      orderBy: { updatedAt: "desc" },
      take: searchTake
    }),
    prisma.lead.findMany({
      where: { ...scoped, OR: [{ title: contains }, { source: contains }] },
      include: { person: true, organization: true },
      orderBy: { updatedAt: "desc" },
      take: searchTake
    }),
    prisma.person.findMany({
      where: {
        ...scoped,
        OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }]
      },
      include: { organization: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: searchTake
    }),
    prisma.organization.findMany({
      where: { ...scoped, OR: [{ name: contains }, { domain: contains }] },
      orderBy: { name: "asc" },
      take: searchTake
    }),
    prisma.activity.findMany({
      where: { ...scoped, OR: [{ title: contains }, { description: contains }] },
      include: { deal: true, lead: true, person: true, organization: true },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }],
      take: searchTake
    }),
    prisma.note.findMany({
      where: { ...scoped, body: contains },
      include: { deal: true, lead: true, person: true, organization: true, author: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: searchTake
    })
  ]);

  return { query, deals, leads, people, organizations, activities, notes };
}
