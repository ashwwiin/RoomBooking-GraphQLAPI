import { makeExecutableSchema } from "@graphql-tools/schema";
import { readFileSync } from "fs";
import { createYoga } from "graphql-yoga";
import { join } from "path";
import { createContext } from "./context";
import { resolvers } from "./resolvers";

export function createYogaServer() {
  const schemaPath = join(import.meta.dir, "schema", "schema.graphql");
  const typeDefs = readFileSync(schemaPath, "utf-8");

  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  const yoga = createYoga({
    schema,
    context: () => createContext(),
    graphqlEndpoint: "/graphql",
    landingPage: true,
  });

  return yoga;
}