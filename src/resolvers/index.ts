import { DateTimeScalar } from "../utils/datetime";
import { bookingResolvers } from "./booking.resolver";
import { resourceResolvers } from "./resource.resolver";

export const resolvers = {
  DateTime: DateTimeScalar,
  Query: {
    ...resourceResolvers.Query,
    ...bookingResolvers.Query,
  },
  Mutation: {
    ...resourceResolvers.Mutation,
    ...bookingResolvers.Mutation,
  },
  Resource: {
    ...resourceResolvers.Resource,
  },
  Booking: {
    ...bookingResolvers.Booking,
  },
};