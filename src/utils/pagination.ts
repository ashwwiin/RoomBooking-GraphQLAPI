import { Booking, Prisma } from "@prisma/client";

export interface DecodedCursor {
  startTime: Date;
  id: string;
}

export function encodeCursor(booking: Booking): string {
  const payload = {
    s: booking.startTime.toISOString(),
    id: booking.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.s || !parsed.id) {
      throw new Error("Missing cursor fields");
    }
    const startTime = new Date(parsed.s);
    if (isNaN(startTime.getTime())) {
      throw new Error("Invalid date in cursor");
    }
    return { startTime, id: parsed.id };
  } catch {
    throw new Error("Invalid pagination cursor provided");
  }
}

export function buildCursorWhereClause(
  baseWhere: Prisma.BookingWhereInput,
  after?: string
): Prisma.BookingWhereInput {
  if (!after) {
    return baseWhere;
  }

  const { startTime, id } = decodeCursor(after);

  const cursorCondition: Prisma.BookingWhereInput = {
    OR: [
      {
        startTime: {
          gt: startTime,
        },
      },
      {
        startTime: {
          equals: startTime,
        },
        id: {
          gt: id,
        },
      },
    ],
  };

  return {
    AND: [baseWhere, cursorCondition],
  };
}