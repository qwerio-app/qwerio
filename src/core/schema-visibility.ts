const INTERNAL_SCHEMA_NAMES = new Set([
  "pg_catalog",
  "pg_toast",
  "information_schema",
  "sys",
]);

export type NamedSchema = { name: string };

export function isInternalSchemaName(schemaName: string): boolean {
  return INTERNAL_SCHEMA_NAMES.has(schemaName.trim().toLowerCase());
}

export function filterVisibleSchemas(
  schemas: NamedSchema[],
  showInternalSchemas: boolean,
): NamedSchema[] {
  if (showInternalSchemas) {
    return schemas;
  }

  return schemas.filter((schema) => !isInternalSchemaName(schema.name));
}
