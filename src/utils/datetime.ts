import { GraphQLScalarType, Kind } from "graphql";

export const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description: "A date-time string in ISO 8601 format, such as 2026-08-25T14:30:00Z",
  serialize(value: unknown): string {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new TypeError("DateTime cannot represent an invalid Date instance");
      }
      return value.toISOString();
    }
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new TypeError(`DateTime cannot represent invalid date value: ${value}`);
      }
      return date.toISOString();
    }
    throw new TypeError(`DateTime cannot represent non-string or non-Date type: ${value}`);
  },
  parseValue(value: unknown): Date {
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new TypeError(`Value is not a valid date string: ${value}`);
      }
      return date;
    }
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new TypeError("Invalid Date object provided");
      }
      return value;
    }
    throw new TypeError(`DateTime cannot parse non-string or non-number value: ${value}`);
  },
  parseLiteral(ast): Date {
    if (ast.kind === Kind.STRING) {
      const date = new Date(ast.value);
      if (isNaN(date.getTime())) {
        throw new TypeError(`Literal is not a valid ISO 8601 date string: ${ast.value}`);
      }
      return date;
    }
    throw new TypeError(`DateTime cannot parse literal of type ${ast.kind}`);
  },
});