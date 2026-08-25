# Room Booking GraphQL API

A high-performance, concurrency-safe Room Booking GraphQL API built with **Bun**, **TypeScript (strict mode)**, **GraphQL Yoga** (Schema-First), **Prisma ORM**, and **PostgreSQL**.

---

## Key Features

- **Schema-First GraphQL Design**: Clean `.graphql` type definitions with strict scalar handling (`DateTime`), Relay-compliant cursor pagination, and expressive input/payload types.
- **Strict Half-Open Interval Overlap Handling (`[startTime, endTime)`)**:
  - Confirmed bookings on the same resource can **never** overlap.
  - Back-to-back bookings (e.g. `10:00-11:00` and `11:00-12:00`) are fully supported without conflicts.
  - Cancelled bookings immediately free up the slot for new reservations.
  - Rescheduling re-evaluates conflicts excluding the target booking itself.
- **Concurrency Safety & Race Condition Prevention**:
  - Uses PostgreSQL transactional advisory locks (`pg_advisory_xact_lock`) serialized on the target `resourceId` inside Prisma transactions.
  - Guarantees zero double-bookings even under heavy parallel load.
- **Relay Cursor-Based Pagination**:
  - High-performance deterministic pagination using `(startTime, id)` composite cursor indexing.
- **PostgreSQL Optimized Indexing**:
  - `@@index([resourceId, status, startTime, endTime])` for instantaneous interval overlap detection.
  - `@@index([startTime, id])` for indexed cursor pagination traversal.
- **Comprehensive DB-Backed Test Suite**:
  - Full test coverage for overlaps, back-to-back slots, cancellations, rescheduling, pagination, and concurrent race conditions.

---

## Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **Bun** (v1.4+) | Fast all-in-one JavaScript runtime & package manager |
| **TypeScript** | Strict mode type safety |
| **GraphQL Yoga** | Production-ready, lightweight GraphQL server |
| **Prisma ORM** | Type-safe database queries and migrations |
| **PostgreSQL 16** | Relational database with composite indexing & advisory locks |

---

## Getting Started

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/ashwwiin/RoomBooking-GraphQLAPI.git
cd RoomBooking-GraphQLAPI
bun install
```

### 2. Environment Setup

Configure your `DATABASE_URL` in `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/room_booking?schema=public"
PORT=4000
```

### 3. Start PostgreSQL Database

Using Docker Compose:

```bash
docker compose up -d
```

Push schema to PostgreSQL:

```bash
bun run prisma:push
```

### 4. Run Development Server

```bash
bun run dev
```

The GraphQL playground will be available at: **`http://localhost:4000/graphql`**

---

## Running the Test Suite

Run the full automated test suite using Bun's native test runner:

```bash
bun test
```

### Test Coverage Highlights:
- **Interval Overlap Permutations**: Tests exact overlap, partial start overlap, partial end overlap, inner containment, and outer enveloping.
- **Back-to-Back Bookings**: Validates that adjacent intervals sharing an exact boundary (e.g., `10:00-11:00` and `11:00-12:00`) succeed.
- **Cancelled Booking Reuse**: Verifies cancelling a booking immediately releases the slot for reuse.
- **Rescheduling**: Verifies rescheduling against free slots, self-updates without conflict, and rejection on conflicting slots.
- **Concurrency / Race Condition**: Launches 10 parallel simultaneous booking requests for the same slot; asserts exactly 1 succeeds and 9 fail with conflict errors.
- **Cursor Pagination**: Validates forward pagination (`first`, `after`), `PageInfo`, and ordering by `startTime ASC, id ASC`.

---

## Mathematical & Architectural Decisions

### 1. Half-Open Interval Overlap Formula

Time intervals are modeled as $[S_1, E_1)$ and $[S_2, E_2)$. Two intervals overlap if and only if:
$$\max(S_1, S_2) < \min(E_1, E_2) \iff S_1 < E_2 \text{ and } S_2 < E_1$$

In Prisma SQL terms:
```ts
where: {
  resourceId,
  status: 'CONFIRMED',
  startTime: { lt: requestedEndTime },
  endTime: { gt: requestedStartTime },
  ...(excludeId ? { id: { not: excludeId } } : {})
}
```

### 2. Concurrency Control & Advisory Locks

To prevent race conditions where two simultaneous transactions check availability simultaneously and both commit:
```ts
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking_resource_${resourceId}`}))`;
```
- The advisory lock is scoped to the PostgreSQL transaction lifecycle.
- It only serializes operations on the *same* resource, leaving other resources fully parallel.

---

## GraphQL Schema Reference

### Sample Queries & Mutations

#### 1. Create a Resource
```graphql
mutation {
  createResource(input: { name: "Boardroom Alpha", capacity: 12 }) {
    id
    name
    capacity
  }
}
```

#### 2. Check Availability
```graphql
query {
  checkAvailability(
    resourceId: "RESOURCE_ID"
    startTime: "2026-08-25T10:00:00Z"
    endTime: "2026-08-25T11:00:00Z"
  ) {
    isAvailable
    conflictingBookings {
      id
      title
      startTime
      endTime
    }
  }
}
```

#### 3. Create a Booking
```graphql
mutation {
  createBooking(
    input: {
      resourceId: "RESOURCE_ID"
      title: "Quarterly Strategy Review"
      startTime: "2026-08-25T10:00:00Z"
      endTime: "2026-08-25T11:00:00Z"
    }
  ) {
    id
    title
    status
    startTime
    endTime
  }
}
```

#### 4. Reschedule a Booking
```graphql
mutation {
  rescheduleBooking(
    input: {
      id: "BOOKING_ID"
      startTime: "2026-08-25T11:00:00Z"
      endTime: "2026-08-25T12:00:00Z"
    }
  ) {
    id
    startTime
    endTime
    status
  }
}
```

#### 5. Cancel a Booking
```graphql
mutation {
  cancelBooking(id: "BOOKING_ID") {
    id
    status
  }
}
```

#### 6. Cursor-Based Bookings Query
```graphql
query {
  bookings(first: 10, after: "CURSOR_STRING", filter: { status: CONFIRMED }) {
    totalCount
    pageInfo {
      hasNextPage
      hasPreviousPage
      endCursor
    }
    edges {
      cursor
      node {
        id
        title
        startTime
        endTime
        resource {
          name
        }
      }
    }
  }
}
```