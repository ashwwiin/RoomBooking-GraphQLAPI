import { describe, expect, it } from "bun:test";
import { BookingService } from "../src/services/booking.service";
import { ResourceService } from "../src/services/resource.service";
import { createInMemoryPrismaClient } from "./mock-db";

describe("Concurrency & Race Condition Handling", () => {
  it("prevents double-booking when multiple concurrent requests target the same slot", async () => {
    const prisma = createInMemoryPrismaClient();
    const resourceService = new ResourceService(prisma);
    const bookingService = new BookingService(prisma);

    const resource = await resourceService.createResource({
      name: "Hot Desk 42",
      capacity: 1,
    });

    const startTime = new Date("2026-08-25T10:00:00.000Z");
    const endTime = new Date("2026-08-25T11:00:00.000Z");

    // Launch 10 simultaneous booking attempts
    const concurrentAttempts = Array.from({ length: 10 }, (_, i) =>
      bookingService.createBooking({
        resourceId: resource.id,
        title: `Concurrent User ${i + 1}`,
        startTime,
        endTime,
      })
    );

    const results = await Promise.allSettled(concurrentAttempts);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // Exactly 1 booking must succeed
    expect(successful.length).toBe(1);
    // The remaining 9 must fail
    expect(failed.length).toBe(9);

    // Verify error message on failed requests
    for (const fail of failed) {
      if (fail.status === "rejected") {
        expect(fail.reason.message).toContain("The requested time slot is not available");
      }
    }

    // Verify only 1 booking exists in the database
    const confirmedBookings = await bookingService.getBookings({
      filter: { resourceId: resource.id },
    });
    expect(confirmedBookings.totalCount).toBe(1);
  });
});