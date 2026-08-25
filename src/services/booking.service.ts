import { Booking, BookingStatus, Prisma, PrismaClient } from "@prisma/client";
import { GraphQLError } from "graphql";
import { buildCursorWhereClause, encodeCursor } from "../utils/pagination";

export interface CreateBookingInput {
  resourceId: string;
  title: string;
  startTime: Date;
  endTime: Date;
}

export interface RescheduleBookingInput {
  id: string;
  startTime: Date;
  endTime: Date;
}

export interface BookingFilterInput {
  resourceId?: string;
  status?: BookingStatus;
  startTimeGte?: Date;
  endTimeLte?: Date;
}

export interface PaginationArgs {
  filter?: BookingFilterInput;
  first?: number;
  after?: string;
}

export interface AvailabilityResult {
  isAvailable: boolean;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  conflictingBookings: Booking[];
}

export class BookingService {
  constructor(private prisma: PrismaClient) {}

  private validateTimeInterval(startTime: Date, endTime: Date) {
    if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
      throw new GraphQLError("Invalid startTime provided.", {
        extensions: { code: "BAD_USER_INPUT", field: "startTime" },
      });
    }

    if (!(endTime instanceof Date) || isNaN(endTime.getTime())) {
      throw new GraphQLError("Invalid endTime provided.", {
        extensions: { code: "BAD_USER_INPUT", field: "endTime" },
      });
    }

    if (startTime.getTime() >= endTime.getTime()) {
      throw new GraphQLError("startTime must be strictly before endTime.", {
        extensions: { code: "BAD_USER_INPUT", field: "endTime" },
      });
    }
  }

  /**
   * Half-open interval conflict check: [S1, E1) overlaps [S2, E2) <=> S1 < E2 AND S2 < E1.
   * Only CONFIRMED bookings block slots. Cancelled bookings are ignored.
   */
  private async findConflicts(
    tx: Prisma.TransactionClient,
    resourceId: string,
    startTime: Date,
    endTime: Date,
    excludeBookingId?: string
  ): Promise<Booking[]> {
    return tx.booking.findMany({
      where: {
        resourceId,
        status: BookingStatus.CONFIRMED,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      orderBy: { startTime: "asc" },
    });
  }

  /**
   * Acquire a PostgreSQL transaction-scoped advisory lock for a resource.
   * Ensures serialized booking attempts on the same resource to prevent double bookings.
   */
  private async acquireResourceLock(tx: Prisma.TransactionClient, resourceId: string): Promise<void> {
    try {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking_resource_${resourceId}`}))`;
    } catch (err) {
      // In non-Postgres or unsupported environments, continue with standard transaction
      console.warn("Advisory lock not acquired or unsupported:", err);
    }
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const trimmedTitle = input.title?.trim();
    if (!trimmedTitle) {
      throw new GraphQLError("Booking title cannot be empty.", {
        extensions: { code: "BAD_USER_INPUT", field: "title" },
      });
    }

    this.validateTimeInterval(input.startTime, input.endTime);

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Verify resource exists
        const resource = await tx.resource.findUnique({
          where: { id: input.resourceId },
        });

        if (!resource) {
          throw new GraphQLError(`Resource with ID '${input.resourceId}' not found.`, {
            extensions: { code: "NOT_FOUND", field: "resourceId" },
          });
        }

        // 2. Acquire transaction-level lock on resource to prevent race conditions
        await this.acquireResourceLock(tx, input.resourceId);

        // 3. Check for overlapping confirmed bookings
        const conflicts = await this.findConflicts(
          tx,
          input.resourceId,
          input.startTime,
          input.endTime
        );

        if (conflicts.length > 0) {
          throw new GraphQLError(
            "The requested time slot is not available due to an overlapping confirmed booking.",
            {
              extensions: {
                code: "CONFLICT",
                conflicts: conflicts.map((b) => ({
                  id: b.id,
                  title: b.title,
                  startTime: b.startTime.toISOString(),
                  endTime: b.endTime.toISOString(),
                })),
              },
            }
          );
        }

        // 4. Create confirmed booking
        return tx.booking.create({
          data: {
            resourceId: input.resourceId,
            title: trimmedTitle,
            startTime: input.startTime,
            endTime: input.endTime,
            status: BookingStatus.CONFIRMED,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );
  }

  async rescheduleBooking(input: RescheduleBookingInput): Promise<Booking> {
    this.validateTimeInterval(input.startTime, input.endTime);

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Fetch existing booking
        const existingBooking = await tx.booking.findUnique({
          where: { id: input.id },
        });

        if (!existingBooking) {
          throw new GraphQLError(`Booking with ID '${input.id}' not found.`, {
            extensions: { code: "NOT_FOUND", field: "id" },
          });
        }

        if (existingBooking.status === BookingStatus.CANCELLED) {
          throw new GraphQLError("Cannot reschedule a cancelled booking. Please create a new booking instead.", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }

        // 2. Lock the resource
        await this.acquireResourceLock(tx, existingBooking.resourceId);

        // 3. Check for conflicts excluding the current booking
        const conflicts = await this.findConflicts(
          tx,
          existingBooking.resourceId,
          input.startTime,
          input.endTime,
          existingBooking.id
        );

        if (conflicts.length > 0) {
          throw new GraphQLError(
            "Cannot reschedule: the new time slot conflicts with an existing confirmed booking.",
            {
              extensions: {
                code: "CONFLICT",
                conflicts: conflicts.map((b) => ({
                  id: b.id,
                  title: b.title,
                  startTime: b.startTime.toISOString(),
                  endTime: b.endTime.toISOString(),
                })),
              },
            }
          );
        }

        // 4. Update the booking times
        return tx.booking.update({
          where: { id: input.id },
          data: {
            startTime: input.startTime,
            endTime: input.endTime,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );
  }

  async cancelBooking(id: string): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      throw new GraphQLError(`Booking with ID '${id}' not found.`, {
        extensions: { code: "NOT_FOUND", field: "id" },
      });
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return booking;
    }

    return this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
      },
    });
  }

  async deleteBooking(id: string): Promise<boolean> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      throw new GraphQLError(`Booking with ID '${id}' not found.`, {
        extensions: { code: "NOT_FOUND", field: "id" },
      });
    }

    await this.prisma.booking.delete({
      where: { id },
    });

    return true;
  }

  async checkAvailability(
    resourceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<AvailabilityResult> {
    this.validateTimeInterval(startTime, endTime);

    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new GraphQLError(`Resource with ID '${resourceId}' not found.`, {
        extensions: { code: "NOT_FOUND", field: "resourceId" },
      });
    }

    const conflicts = await this.findConflicts(
      this.prisma,
      resourceId,
      startTime,
      endTime
    );

    return {
      isAvailable: conflicts.length === 0,
      resourceId,
      startTime,
      endTime,
      conflictingBookings: conflicts,
    };
  }

  async getBookings(args: PaginationArgs) {
    const { filter, first = 20, after } = args;

    const limit = Math.min(Math.max(first, 1), 100);

    const baseWhere: Prisma.BookingWhereInput = {};

    if (filter?.resourceId) {
      baseWhere.resourceId = filter.resourceId;
    }

    if (filter?.status) {
      baseWhere.status = filter.status;
    }

    if (filter?.startTimeGte || filter?.endTimeLte) {
      baseWhere.startTime = filter.startTimeGte ? { gte: filter.startTimeGte } : undefined;
      baseWhere.endTime = filter.endTimeLte ? { lte: filter.endTimeLte } : undefined;
    }

    const where = buildCursorWhereClause(baseWhere, after);

    const [totalCount, items] = await Promise.all([
      this.prisma.booking.count({ where: baseWhere }),
      this.prisma.booking.findMany({
        where,
        take: limit + 1, // Fetch 1 extra to determine hasNextPage
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
      }),
    ]);

    const hasNextPage = items.length > limit;
    const nodes = hasNextPage ? items.slice(0, limit) : items;

    const edges = nodes.map((node) => ({
      cursor: encodeCursor(node),
      node,
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!after,
        startCursor: edges.length > 0 ? edges[0].cursor : null,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
      totalCount,
    };
  }
}