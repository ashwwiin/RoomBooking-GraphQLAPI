import { BookingStatus, Resource } from "@prisma/client";
import { GraphQLContext } from "../context";
import { CreateResourceInput, ResourceService } from "../services/resource.service";

export const resourceResolvers = {
  Query: {
    resources: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
      const service = new ResourceService(context.prisma);
      return service.getAllResources();
    },
    resource: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      const service = new ResourceService(context.prisma);
      return service.getResourceById(args.id);
    },
  },
  Mutation: {
    createResource: async (
      _parent: unknown,
      args: { input: CreateResourceInput },
      context: GraphQLContext
    ) => {
      const service = new ResourceService(context.prisma);
      return service.createResource(args.input);
    },
  },
  Resource: {
    bookings: async (
      parent: Resource,
      args: { status?: BookingStatus },
      context: GraphQLContext
    ) => {
      const service = new ResourceService(context.prisma);
      return service.getResourceBookings(parent.id, args.status);
    },
  },
};