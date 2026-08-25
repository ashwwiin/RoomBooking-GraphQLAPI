import { createYogaServer } from "./server";

const port = Number(process.env.PORT) || 4000;
const yoga = createYogaServer();

const server = Bun.serve({
  port,
  fetch(req) {
    return yoga.fetch(req);
  },
});

console.log(`🚀 Room Booking GraphQL API is running on http://localhost:${server.port}/graphql`);