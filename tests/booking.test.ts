import { BookingStatus, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "bun:test";
import { BookingService } from "../src/services/booking.service";
import { ResourceService } from "../src/services/resource.service";
import { createInMemoryPrismaClient } from "./mock-db";

describe("Room Booking API Core Domain & Business Logic", () => {
  let prisma: PrismaClient;
  let resourceService: ResourceService;
  let bookingService: BookingService;
  let testResourceId: string;

  beforeEach(async () => {
    prisma = createInMemoryPrismaClient();
    resourceService = new ResourceService(prisma);
    bookingService = new BookingService(prisma);

    const resource = await resourceService.createResource({
      name: "Conference Room Alpha",
      capacity: 10,
    });
    testResourceId = resource.id;
  });

  describe("Resource Management", () => {
    it("creates a resource with valid name and capacity", async () => {
      const resource = await resourceService.createResource({
        name: "Projector Beta",
        capacity: 1,
      });
      expect(resource.id).toBeDefined();
      expect(resource.name).toBe("Projector Beta");
      expect(resource.capacity).toBe(1);
    });

    it("rejects resource creation with empty name or non-positive capacity", async () => {
      expect(
        resourceService.createResource({ name: "   ", capacity: 5 })
      ).rejects.toThrow("Resource name cannot be empty");

      expect(
        resourceService.createResource({ name: "Room 1", capacity: 0 })
      ).rejects.toThrow("capacity must be a positive integer");
    });
  });

  describe("Time-Interval Validation & Half-Open Overlaps [S, E)", () => {
    it("rejects booking if startTime >= endTime", async () => {
      const t1 = new Date("2026-08-25T11:00:00.000Z");
      const t2 = new Date("2026-08-25T10:00:00.000Z");

      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "Invalid Interval",
          startTime: t1,
          endTime: t2,
        })
      ).rejects.toThrow("startTime must be strictly before endTime");

      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "Equal Time",
          startTime: t1,
          endTime: t1,
        })
      ).rejects.toThrow("startTime must be strictly before endTime");
    });

    it("allows back-to-back bookings on the same resource without conflict", async () => {
      // Slot 1: [10:00, 11:00)
      const b1 = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Sprint Planning",
        startTime: new Date("2026-08-25T10:00:00.000Z"),
        endTime: new Date("2026-08-25T11:00:00.000Z"),
      });

      // Slot 2: [11:00, 12:00) - Back-to-back immediately after Slot 1
      const b2 = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Architecture Review",
        startTime: new Date("2026-08-25T11:00:00.000Z"),
        endTime: new Date("2026-08-25T12:00:00.000Z"),
      });

      // Slot 0: [09:00, 10:00) - Back-to-back immediately before Slot 1
      const b0 = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Daily Standup",
        startTime: new Date("2026-08-25T09:00:00.000Z"),
        endTime: new Date("2026-08-25T10:00:00.000Z"),
      });

      expect(b1.status).toBe(BookingStatus.CONFIRMED);
      expect(b2.status).toBe(BookingStatus.CONFIRMED);
      expect(b0.status).toBe(BookingStatus.CONFIRMED);
    });

    it("rejects overlapping booking attempts with detailed conflict info", async () => {
      // Base booking: [10:00, 11:00)
      await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Base Meeting",
        startTime: new Date("2026-08-25T10:00:00.000Z"),
        endTime: new Date("2026-08-25T11:00:00.000Z"),
      });

      // Case 1: Exact match [10:00, 11:00)
      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "Exact Overlap",
          startTime: new Date("2026-08-25T10:00:00.000Z"),
          endTime: new Date("2026-08-25T11:00:00.000Z"),
        })
      ).rejects.toThrow("The requested time slot is not available");

      // Case 2: Partial overlap at the end [10:30, 11:30)
      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "End Overlap",
          startTime: new Date("2026-08-25T10:30:00.000Z"),
          endTime: new Date("2026-08-25T11:30:00.000Z"),
        })
      ).rejects.toThrow("The requested time slot is not available");

      // Case 3: Partial overlap at the start [09:30, 10:30)
      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "Start Overlap",
          startTime: new Date("2026-08-25T09:30:00.000Z"),
          endTime: new Date("2026-08-25T10:30:00.000Z"),
        })
      ).rejects.toThrow("The requested time slot is not available");

      // Case 4: Enclosed inside [10:15, 10:45)
      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "Inner Overlap",
          startTime: new Date("2026-08-25T10:15:00.000Z"),
          endTime: new Date("2026-08-25T10:45:00.000Z"),
        })
      ).rejects.toThrow("The requested time slot is not available");

      // Case 5: Enveloping [09:00, 12:00)
      expect(
        bookingService.createBooking({
          resourceId: testResourceId,
          title: "Outer Enveloping",
          startTime: new Date("2026-08-25T09:00:00.000Z"),
          endTime: new Date("2026-08-25T12:00:00.000Z"),
        })
      ).rejects.toThrow("The requested time slot is not available");
    });
  });

  describe("Cancelled Booking Reuse", () => {
    it("releases time slot when cancelled so it can be re-booked", async () => {
      const slotStart = new Date("2026-08-25T14:00:00.000Z");
      const slotEnd = new Date("2026-08-25T15:00:00.000Z");

      const booking1 = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Initial Booking",
        startTime: slotStart,
        endTime: slotEnd,
      });

      // Cancel the booking
      const cancelled = await bookingService.cancelBooking(booking1.id);
      expect(cancelled.status).toBe(BookingStatus.CANCELLED);

      // Verify availability check now reports available
      const avail = await bookingService.checkAvailability(
        testResourceId,
        slotStart,
        slotEnd
      );
      expect(avail.isAvailable).toBe(true);
      expect(avail.conflictingBookings.length).toBe(0);

      // Book the exact same slot again
      const booking2 = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "New Booking on Released Slot",
        startTime: slotStart,
        endTime: slotEnd,
      });

      expect(booking2.status).toBe(BookingStatus.CONFIRMED);
      expect(booking2.id).not.toBe(booking1.id);
    });
  });

  describe("Rescheduling Logic", () => {
    it("reschedules a booking to an unoccupied time slot", async () => {
      const booking = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Client Sync",
        startTime: new Date("2026-08-25T10:00:00.000Z"),
        endTime: new Date("2026-08-25T11:00:00.000Z"),
      });

      const rescheduled = await bookingService.rescheduleBooking({
        id: booking.id,
        startTime: new Date("2026-08-25T15:00:00.000Z"),
        endTime: new Date("2026-08-25T16:00:00.000Z"),
      });

      expect(rescheduled.startTime.toISOString()).toBe("2026-08-25T15:00:00.000Z");
      expect(rescheduled.endTime.toISOString()).toBe("2026-08-25T16:00:00.000Z");
    });

    it("allows updating to the same slot without self-conflicting", async () => {
      const booking = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Self Check",
        startTime: new Date("2026-08-25T10:00:00.000Z"),
        endTime: new Date("2026-08-25T11:00:00.000Z"),
      });

      const updated = await bookingService.rescheduleBooking({
        id: booking.id,
        startTime: new Date("2026-08-25T10:00:00.000Z"),
        endTime: new Date("2026-08-25T11:00:00.000Z"),
      });

      expect(updated.id).toBe(booking.id);
    });

    it("blocks rescheduling if target slot conflicts with another confirmed booking", async () => {
      await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Occupied Slot",
        startTime: new Date("2026-08-25T14:00:00.000Z"),
        endTime: new Date("2026-08-25T15:00:00.000Z"),
      });

      const bookingToMove = await bookingService.createBooking({
        resourceId: testResourceId,
        title: "Booking To Move",
        startTime: new Date("2026-08-25T09:00:00.000Z"),
        endTime: new Date("2026-08-25T10:00:00.000Z"),
      });

      expect(
        bookingService.rescheduleBooking({
          id: bookingToMove.id,
          startTime: new Date("2026-08-25T14:30:00.000Z"),
          endTime: new Date("2026-08-25T15:30:00.000Z"),
        })
      ).rejects.toThrow("Cannot reschedule: the new time slot conflicts");
    });
  });

  describe("Cursor-Based Pagination", () => {
    it("paginates bookings ordered by startTime ASC, id ASC with cursors", async () => {
      // Create 5 sequential bookings
      for (let i = 9; i < 14; i++) {
        const hour = i < 10 ? `0${i}` : `${i}`;
        const nextHour = i + 1 < 10 ? `0${i + 1}` : `${i + 1}`;
        await bookingService.createBooking({
          resourceId: testResourceId,
          title: `Booking at ${hour}:00`,
          startTime: new Date(`2026-08-25T${hour}:00:00.000Z`),
          endTime: new Date(`2026-08-25T${nextHour}:00:00.000Z`),
        });
      }

      // Page 1: First 2 bookings
      const page1 = await bookingService.getBookings({
        filter: { resourceId: testResourceId },
        first: 2,
      });

      expect(page1.edges.length).toBe(2);
      expect(page1.totalCount).toBe(5);
      expect(page1.pageInfo.hasNextPage).toBe(true);
      expect(page1.edges[0].node.title).toBe("Booking at 09:00");
      expect(page1.edges[1].node.title).toBe("Booking at 10:00");

      // Page 2: Next 2 bookings after page1.pageInfo.endCursor
      const page2 = await bookingService.getBookings({
        filter: { resourceId: testResourceId },
        first: 2,
        after: page1.pageInfo.endCursor!,
      });

      expect(page2.edges.length).toBe(2);
      expect(page2.pageInfo.hasNextPage).toBe(true);
      expect(page2.edges[0].node.title).toBe("Booking at 11:00");
      expect(page2.edges[1].node.title).toBe("Booking at 12:00");

      // Page 3: Final page
      const page3 = await bookingService.getBookings({
        filter: { resourceId: testResourceId },
        first: 2,
        after: page2.pageInfo.endCursor!,
      });

      expect(page3.edges.length).toBe(1);
      expect(page3.pageInfo.hasNextPage).toBe(false);
      expect(page3.edges[0].node.title).toBe("Booking at 13:00");
    });
  });
});