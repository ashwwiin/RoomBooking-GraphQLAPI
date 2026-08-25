import { Booking, BookingStatus, PrismaClient, Resource } from "@prisma/client";
import { randomUUID } from "crypto";

export interface InMemoryStore {
  resources: Map<string, Resource>;
  bookings: Map<string, Booking>;
}

export function createInMemoryPrismaClient(): PrismaClient {
  const store: InMemoryStore = {
    resources: new Map(),
    bookings: new Map(),
  };

  let transactionQueue = Promise.resolve();

  const resourceDelegate = {
    async create({ data }: { data: { name: string; capacity: number } }) {
      const now = new Date();
      const resource: Resource = {
        id: randomUUID(),
        name: data.name,
        capacity: data.capacity,
        createdAt: now,
        updatedAt: now,
      };
      store.resources.set(resource.id, resource);
      return resource;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return store.resources.get(where.id) || null;
    },
    async findMany({ orderBy }: { orderBy?: { createdAt?: "asc" | "desc" } } = {}) {
      const list = Array.from(store.resources.values());
      if (orderBy?.createdAt === "desc") {
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return list;
    },
    async delete({ where }: { where: { id: string } }) {
      const existing = store.resources.get(where.id);
      if (existing) {
        store.resources.delete(where.id);
        for (const [bId, booking] of store.bookings.entries()) {
          if (booking.resourceId === where.id) {
            store.bookings.delete(bId);
          }
        }
      }
      return existing || null;
    },
  };

  const bookingDelegate = {
    async create({
      data,
    }: {
      data: {
        resourceId: string;
        title: string;
        startTime: Date;
        endTime: Date;
        status?: BookingStatus;
      };
    }) {
      const now = new Date();
      const booking: Booking = {
        id: randomUUID(),
        title: data.title,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        status: data.status || BookingStatus.CONFIRMED,
        resourceId: data.resourceId,
        createdAt: now,
        updatedAt: now,
      };
      store.bookings.set(booking.id, booking);
      return booking;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return store.bookings.get(where.id) || null;
    },
    async findMany(args: {
      where?: any;
      take?: number;
      orderBy?: any;
    } = {}) {
      let list = Array.from(store.bookings.values());

      if (args.where) {
        const w = args.where;
        list = list.filter((b) => {
          if (w.resourceId && b.resourceId !== w.resourceId) return false;
          if (w.status && b.status !== w.status) return false;
          if (w.id?.not && b.id === w.id.not) return false;
          if (w.startTime?.lt && !(b.startTime < w.startTime.lt)) return false;
          if (w.endTime?.gt && !(b.endTime > w.endTime.gt)) return false;
          if (w.startTime?.gte && !(b.startTime >= w.startTime.gte)) return false;
          if (w.endTime?.lte && !(b.endTime <= w.endTime.lte)) return false;

          if (w.AND && Array.isArray(w.AND)) {
            for (const cond of w.AND) {
              if (cond.OR && Array.isArray(cond.OR)) {
                const orMatch = cond.OR.some((orCond: any) => {
                  if (orCond.startTime?.gt && b.startTime > orCond.startTime.gt) return true;
                  if (
                    orCond.startTime?.equals &&
                    b.startTime.getTime() === orCond.startTime.equals.getTime() &&
                    orCond.id?.gt &&
                    b.id > orCond.id.gt
                  ) {
                    return true;
                  }
                  return false;
                });
                if (!orMatch) return false;
              }
            }
          }

          return true;
        });
      }

      list.sort((a, b) => {
        const diff = a.startTime.getTime() - b.startTime.getTime();
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      });

      if (args.take) {
        list = list.slice(0, args.take);
      }

      return list;
    },
    async count(args: { where?: any } = {}) {
      const items = await bookingDelegate.findMany({ where: args.where });
      return items.length;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Booking>;
    }) {
      const booking = store.bookings.get(where.id);
      if (!booking) throw new Error("Booking not found");
      const updated: Booking = {
        ...booking,
        ...data,
        updatedAt: new Date(),
      };
      store.bookings.set(where.id, updated);
      return updated;
    },
    async delete({ where }: { where: { id: string } }) {
      const booking = store.bookings.get(where.id);
      if (booking) {
        store.bookings.delete(where.id);
      }
      return booking;
    },
  };

  const client: any = {
    resource: resourceDelegate,
    booking: bookingDelegate,
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      // Simulate PostgreSQL transaction serialization / advisory locking
      const nextInQueue = transactionQueue.then(() => fn(client));
      transactionQueue = nextInQueue.catch(() => {});
      return nextInQueue;
    },
  };

  return client as PrismaClient;
}