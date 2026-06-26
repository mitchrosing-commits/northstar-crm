import { Prisma } from "@prisma/client";

export const userDisplaySelect = {
  id: true,
  name: true,
  email: true
} satisfies Prisma.UserSelect;
