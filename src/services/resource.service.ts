import { BookingStatus, PrismaClient, Resource } from "@prisma/client";
import { GraphQLError } from "graphql";

export interface CreateResourceInput {
  name: string;
  capacity: number;
}

export class ResourceService {
  constructor(private prisma: PrismaClient) {}

  async createResource(input: CreateResourceInput): Promise<Resource> {
    const trimmedName = input.name?.trim();
    if (!trimmedName) {
      throw new GraphQLError("Resource name cannot be empty.", {
        extensions: { code: "BAD_USER_INPUT", field: "name" },
      });
    }

    if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
      throw new GraphQLError("Resource capacity must be a positive integer.", {
        extensions: { code: "BAD_USER_INPUT", field: "capacity" },
      });
    }

    return this.prisma.resource.create({
      data: {
        name: trimmedName,
        capacity: input.capacity,
      },
    });
  }

  async getAllResources(): Promise<Resource[]> {
    return this.prisma.resource.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async getResourceById(id: string): Promise<Resource | null> {
    return this.prisma.resource.findUnique({
      where: { id },
    });
  }

  async getResourceBookings(resourceId: string, status?: BookingStatus) {
    return this.prisma.booking.findMany({
      where: {
        resourceId,
        ...(status ? { status } : {}),
      },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
  }
}