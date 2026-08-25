import { describe, expect, it } from "bun:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { readFileSync } from "fs";
import { createYoga } from "graphql-yoga";
import { join } from "path";
import { resolvers } from "../src/resolvers";
import { createInMemoryPrismaClient } from "./mock-db";

function createTestYoga() {
  const schemaPath = join(import.meta.dir, "..", "src", "schema", "schema.graphql");
  const typeDefs = readFileSync(schemaPath, "utf-8");
  const testPrisma = createInMemoryPrismaClient();

  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  const yoga = createYoga({
    schema,
    context: () => ({ prisma: testPrisma }),
    graphqlEndpoint: "/graphql",
  });

  return {
    yoga,
    async execute(query: string, variables?: Record<string, any>) {
      const response = await yoga.fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      return response.json();
    },
  };
}

describe("GraphQL API End-to-End Execution", () => {
  it("executes full resource and booking lifecycle via GraphQL mutations & queries", async () => {
    const { execute } = createTestYoga();

    // 1. Create Resource
    const createResourceRes = await execute(`
      mutation CreateRes($input: CreateResourceInput!) {
        createResource(input: $input) {
          id
          name
          capacity
        }
      }
    `, {
      input: { name: "Boardroom Delta", capacity: 18 },
    });

    expect(createResourceRes.errors).toBeUndefined();
    const resourceId = createResourceRes.data.createResource.id;
    expect(createResourceRes.data.createResource.name).toBe("Boardroom Delta");

    // 2. Check Availability (initially available)
    const checkRes1 = await execute(`
      query CheckAvail($resourceId: ID!, $start: DateTime!, $end: DateTime!) {
        checkAvailability(resourceId: $resourceId, startTime: $start, endTime: $end) {
          isAvailable
          conflictingBookings {
            id
            title
          }
        }
      }
    `, {
      resourceId,
      start: "2026-08-25T14:00:00.000Z",
      end: "2026-08-25T15:00:00.000Z",
    });

    expect(checkRes1.data.checkAvailability.isAvailable).toBe(true);

    // 3. Create Booking
    const createBookingRes = await execute(`
      mutation CreateBk($input: CreateBookingInput!) {
        createBooking(input: $input) {
          id
          title
          status
          resource {
            name
          }
        }
      }
    `, {
      input: {
        resourceId,
        title: "Q3 Strategy Meeting",
        startTime: "2026-08-25T14:00:00.000Z",
        endTime: "2026-08-25T15:00:00.000Z",
      },
    });

    expect(createBookingRes.errors).toBeUndefined();
    const bookingId = createBookingRes.data.createBooking.id;
    expect(createBookingRes.data.createBooking.resource.name).toBe("Boardroom Delta");

    // 4. Check Availability again (should now be unavailable)
    const checkRes2 = await execute(`
      query CheckAvail($resourceId: ID!, $start: DateTime!, $end: DateTime!) {
        checkAvailability(resourceId: $resourceId, startTime: $start, endTime: $end) {
          isAvailable
          conflictingBookings {
            id
            title
          }
        }
      }
    `, {
      resourceId,
      start: "2026-08-25T14:30:00.000Z",
      end: "2026-08-25T15:30:00.000Z",
    });

    expect(checkRes2.data.checkAvailability.isAvailable).toBe(false);
    expect(checkRes2.data.checkAvailability.conflictingBookings.length).toBe(1);

    // 5. Query Resource with nested bookings
    const resourceQueryRes = await execute(`
      query GetRes($id: ID!) {
        resource(id: $id) {
          name
          bookings {
            id
            title
            status
          }
        }
      }
    `, { id: resourceId });

    expect(resourceQueryRes.data.resource.bookings.length).toBe(1);
    expect(resourceQueryRes.data.resource.bookings[0].title).toBe("Q3 Strategy Meeting");

    // 6. Reschedule Booking
    const rescheduleRes = await execute(`
      mutation Resched($input: RescheduleBookingInput!) {
        rescheduleBooking(input: $input) {
          id
          startTime
          endTime
        }
      }
    `, {
      input: {
        id: bookingId,
        startTime: "2026-08-25T16:00:00.000Z",
        endTime: "2026-08-25T17:00:00.000Z",
      },
    });

    expect(rescheduleRes.errors).toBeUndefined();
    expect(rescheduleRes.data.rescheduleBooking.startTime).toBe("2026-08-25T16:00:00.000Z");

    // 7. Cancel Booking
    const cancelRes = await execute(`
      mutation Cancel($id: ID!) {
        cancelBooking(id: $id) {
          id
          status
        }
      }
    `, { id: bookingId });

    expect(cancelRes.data.cancelBooking.status).toBe("CANCELLED");

    // 8. Delete Booking
    const deleteRes = await execute(`
      mutation Del($id: ID!) {
        deleteBooking(id: $id)
      }
    `, { id: bookingId });

    expect(deleteRes.data.deleteBooking).toBe(true);
  });
});