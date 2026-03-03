import { describe, expect, it } from "vitest";
import { createEmptySchemaObjectMap } from "../../../src/core/query-engine";
import {
  buildSqlAutocompleteSuggestions,
  extractSqlVariableNames,
} from "../../../src/core/sql-autocomplete";

describe("extractSqlVariableNames", () => {
  it("extracts unique variables from common placeholder syntaxes", () => {
    const sql = `
      select :user_id, @tenant_id, \${region}, {{ env }};
      select $workspace, $1, cast(name as text), value::text;
      where id = :user_id;
    `;

    expect(extractSqlVariableNames(sql)).toEqual([
      "env",
      "region",
      "tenant_id",
      "user_id",
      "workspace",
    ]);
  });
});

describe("buildSqlAutocompleteSuggestions", () => {
  const schemaObjectMap = {
    analytics: {
      ...createEmptySchemaObjectMap(),
      tables: [{ name: "events" }],
      views: [{ name: "daily_rollup" }],
      functions: [{ name: "calculate_retention" }],
      indexes: [{ name: "events_pkey" }],
    },
    public: {
      ...createEmptySchemaObjectMap(),
      tables: [{ name: "users" }, { name: "orders" }],
      views: [{ name: "active_users" }],
      sequences: [{ name: "users_id_seq" }],
      indexes: [{ name: "users_pkey" }],
    },
  };

  it("suggests only objects from a schema-qualified context", () => {
    const suggestions = buildSqlAutocompleteSuggestions({
      schemaObjectMap,
      sql: "select * from public.",
      linePrefix: "select * from public.",
      wordUntilCursor: "",
    });
    const labels = suggestions.map((suggestion) => suggestion.label);

    expect(labels).toContain("users");
    expect(labels).toContain("orders");
    expect(labels).toContain("active_users");
    expect(labels).not.toContain("events");
    expect(labels).not.toContain("users_pkey");
    expect(labels).not.toContain("public.users");
  });

  it("prioritizes table names and variables in global context", () => {
    const suggestions = buildSqlAutocompleteSuggestions({
      schemaObjectMap,
      sql: "select * from public.users where tenant_id = :tenant_id",
      linePrefix: "select * from ",
      wordUntilCursor: "",
    });

    const labels = suggestions.map((suggestion) => suggestion.label);

    expect(labels).toContain("public.users");
    expect(labels).toContain("analytics.events");
    expect(labels).toContain("tenant_id");
    expect(labels).not.toContain("users_pkey");
    expect(labels).not.toContain("calculate_retention");
  });

  it("limits autocomplete output to five items", () => {
    const suggestions = buildSqlAutocompleteSuggestions({
      schemaObjectMap,
      sql: "select * from ",
      linePrefix: "select * from ",
      wordUntilCursor: "",
    });

    expect(suggestions.length).toBeLessThanOrEqual(5);
  });
});
