import { Booking } from "@prisma/client";
import { GraphQLContext } from "../context";
import {
  BookingService,
  CreateBookingInput,
  PaginationArgs,
  RescheduleBookingInput,
} from "../services/booking.service";

export const bookingResolvers = {
  Query: {
    bookings: async (
      _parent: unknown,
      args: PaginationArgs,
      context: GraphQLContext
    ) => {
      const service = new BookingService(context.prisma);
      return service.getBookings(args);
    },
    checkAvailability: async (
      _parent: unknown,
      args: { resourceId: string; startTime: Date; endTime: Date },
      context: GraphQLContext
    ) => {
      const service = new BookingService(context.prisma);
      return service.checkAvailability(
        args.resourceId,
        args.startTime,
        args.endTime
      );
    },
  },
  Mutation: {
    createBooking: async (
      _parent: unknown,
      args: { input: CreateBookingInput },
      context: GraphQLContext
    ) => {
      const service = new BookingService(context.prisma);
      return service.createBooking(args.input);
    },
    rescheduleBooking: async (
      _parent: unknown,
      args: { input: RescheduleBookingInput },
      context: GraphQLContext
    ) => {
      const service = new BookingService(context.prisma);
      return service.rescheduleBooking(args.input);
    },
    cancelBooking: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      const service = new BookingService(context.prisma);
      return service.cancelBooking(args.id);
    },
    deleteBooking: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      const service = new BookingService(context.prisma);
      return service.deleteBooking(args.id);
    },
  },
  Booking: {
    resource: async (parent: Booking, _args: unknown, context: GraphQLContext) => {
      return context.prisma.resource.findUnique({
        where: { id: parent.resourceId },
      });
    },
  },
};