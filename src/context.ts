import { PrismaClient } from "@prisma/client";
import { prisma } from "./lib/prisma";

export interface GraphQLContext {
  prisma: PrismaClient;
}

export function createContext(): GraphQLContext {
  return {
    prisma,
  };
}