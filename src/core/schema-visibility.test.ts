import { describe, expect, it } from "vitest";
import {
  filterVisibleSchemas,
  isInternalSchemaName,
} from "./schema-visibility";

describe("schema-visibility", () => {
  it("detects internal schema names", () => {
    expect(isInternalSchemaName("pg_catalog")).toBe(true);
    expect(isInternalSchemaName("information_schema")).toBe(true);
    expect(isInternalSchemaName("public")).toBe(false);
  });

  it("filters schemas with the same rules as the sidebar", () => {
    const schemas = [
      { name: "public" },
      { name: "analytics" },
      { name: "pg_catalog" },
      { name: "information_schema" },
    ];

    expect(filterVisibleSchemas(schemas, false)).toEqual([
      { name: "public" },
      { name: "analytics" },
    ]);
    expect(filterVisibleSchemas(schemas, true)).toEqual(schemas);
  });
});
