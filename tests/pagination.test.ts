import { describe, expect, it } from "bun:test";
import { decodeCursor, encodeCursor } from "../src/utils/pagination";

describe("Cursor Pagination Utils", () => {
  it("encodes and decodes cursor accurately", () => {
    const booking = {
      id: "booking-123",
      title: "Design Review",
      startTime: new Date("2026-08-25T10:00:00.000Z"),
      endTime: new Date("2026-08-25T11:00:00.000Z"),
      status: "CONFIRMED" as const,
      resourceId: "resource-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const cursor = encodeCursor(booking);
    expect(typeof cursor).toBe("string");

    const decoded = decodeCursor(cursor);
    expect(decoded.id).toBe("booking-123");
    expect(decoded.startTime.toISOString()).toBe("2026-08-25T10:00:00.000Z");
  });
});