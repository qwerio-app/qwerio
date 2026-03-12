import type { QueryEngine } from "./query-engine";
import type { ConnectionProfile, DbDialect, QueryResult } from "./types";

export type DatabaseSchemaExportFormat = "markdown" | "json";
export type ExportableDialect = Extract<DbDialect, "postgres" | "mysql" | "sqlite">;

export type ExportedSchemaColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  description: string | null;
};

export type ExportedSchemaConstraint = {
  name: string;
  type: string;
  definition: string;
};

export type ExportedSchemaIndex = {
  name: string;
  definition: string;
};

export type ExportedSchemaTrigger = {
  name: string;
  timing: string;
  events: string[];
  action: string;
};

export type ExportedSchemaTable = {
  name: string;
  kind: string;
  description: string | null;
  definition: string | null;
  columns: ExportedSchemaColumn[];
  constraints: ExportedSchemaConstraint[];
  indexes: ExportedSchemaIndex[];
  triggers: ExportedSchemaTrigger[];
};

export type ExportedSchemaView = {
  name: string;
  kind: string;
  description: string | null;
  definition: string | null;
};

export type ExportedSchemaRoutine = {
  name: string;
  kind: string;
  arguments: string;
  returnType: string | null;
  description: string | null;
};

export type ExportedSchemaSequence = {
  name: string;
  dataType: string;
  startValue: string;
  minimumValue: string;
  maximumValue: string | null;
  increment: string;
  cycle: boolean;
};

export type ExportedSchemaEnumType = {
  name: string;
  values: string[];
};

export type ExportedDatabaseSchemaGroup = {
  name: string;
  tables: ExportedSchemaTable[];
  views: ExportedSchemaView[];
  routines: ExportedSchemaRoutine[];
  sequences: ExportedSchemaSequence[];
  enumTypes: ExportedSchemaEnumType[];
};

export type ExportedDatabaseSchema = {
  dialect: ExportableDialect;
  connectionName: string;
  databaseName: string;
  exportedAt: string;
  schemas: ExportedDatabaseSchemaGroup[];
};

type ExportArtifact = {
  fileName: string;
  mimeType: string;
  content: string;
};

type SupportedConnectionProfile = ConnectionProfile & {
  target: Extract<ConnectionProfile["target"], { dialect: ExportableDialect }>;
};

function assertExportableConnection(
  connection: ConnectionProfile,
): asserts connection is SupportedConnectionProfile {
  if (
    connection.target.dialect !== "postgres" &&
    connection.target.dialect !== "mysql" &&
    connection.target.dialect !== "sqlite"
  ) {
    throw new Error("Schema export is currently available for Postgres, MySQL, and SQLite only.");
  }
}

function createSchemaGroup(name: string): ExportedDatabaseSchemaGroup {
  return {
    name,
    tables: [],
    views: [],
    routines: [],
    sequences: [],
    enumTypes: [],
  };
}

function readRows(result: QueryResult): Array<Record<string, unknown>> {
  return result.rows as Array<Record<string, unknown>>;
}

async function execute(
  engine: QueryEngine,
  connectionId: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  return readRows(
    await engine.execute({
      connectionId,
      sql,
    }),
  );
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildSchemaFilterSql(schemaNames: string[]): string {
  return schemaNames.map((schemaName) => quoteSqlLiteral(schemaName)).join(", ");
}

function escapeMarkdownCell(value: string | null): string {
  if (!value) {
    return "-";
  }

  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "-";
}

function formatMarkdownList(items: string[]): string[] {
  return items.length > 0 ? items : ["- None"];
}

function sanitizeFileNamePart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "schema";
}

function formatDialectLabel(dialect: ExportableDialect): string {
  switch (dialect) {
    case "postgres":
      return "Postgres";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
  }
}

function resolveDatabaseName(connection: SupportedConnectionProfile): string {
  if (connection.target.kind === "desktop-tcp") {
    return connection.target.database;
  }

  if (connection.target.dialect === "postgres") {
    try {
      const parsed = new URL(connection.target.connectionStringTemplate);
      const pathname = parsed.pathname.replace(/^\/+/, "").trim();
      return pathname.length > 0 ? decodeURIComponent(pathname) : connection.name;
    } catch {
      return connection.name;
    }
  }

  return connection.name;
}

export function canExportSchemaForDialect(dialect: DbDialect | undefined): dialect is ExportableDialect {
  return dialect === "postgres" || dialect === "mysql" || dialect === "sqlite";
}

export function buildSchemaExportFileName(
  connection: ConnectionProfile,
  format: DatabaseSchemaExportFormat,
  exportedAt: Date,
): string {
  assertExportableConnection(connection);
  const dateToken = exportedAt.toISOString().slice(0, 10);
  const connectionToken = sanitizeFileNamePart(connection.name);
  const databaseToken = sanitizeFileNamePart(resolveDatabaseName(connection));
  const extension = format === "markdown" ? "md" : "json";
  return `${connectionToken}-${databaseToken}-schema-${dateToken}.${extension}`;
}

function createBaseExport(
  connection: SupportedConnectionProfile,
  schemaNames: string[],
): ExportedDatabaseSchema {
  return {
    dialect: connection.target.dialect,
    connectionName: connection.name,
    databaseName: resolveDatabaseName(connection),
    exportedAt: new Date().toISOString(),
    schemas: schemaNames.map((schemaName) => createSchemaGroup(schemaName)),
  };
}

function getSchemaGroupMap(data: ExportedDatabaseSchema): Map<string, ExportedDatabaseSchemaGroup> {
  return new Map(data.schemas.map((schema) => [schema.name, schema]));
}

function getTableLookup(data: ExportedDatabaseSchema): Map<string, ExportedSchemaTable> {
  const lookup = new Map<string, ExportedSchemaTable>();

  data.schemas.forEach((schema) => {
    schema.tables.forEach((table) => {
      lookup.set(`${schema.name}.${table.name}`, table);
    });
  });

  return lookup;
}

function postgresConstraintType(value: string): string {
  switch (value) {
    case "p":
      return "primary-key";
    case "f":
      return "foreign-key";
    case "u":
      return "unique";
    case "c":
      return "check";
    case "x":
      return "exclude";
    default:
      return "other";
  }
}

async function exportPostgresSchema(
  engine: QueryEngine,
  connection: SupportedConnectionProfile,
  schemaNames: string[],
): Promise<ExportedDatabaseSchema> {
  const data = createBaseExport(connection, schemaNames);
  const schemaMap = getSchemaGroupMap(data);
  const schemaFilterSql = buildSchemaFilterSql(schemaNames);
  const [relationRows, columnRows, constraintRows, indexRows, triggerRows, routineRows, sequenceRows, enumRows] =
    await Promise.all([
      execute(
        engine,
        connection.id,
        `select
           n.nspname as schema_name,
           c.relname as object_name,
           c.relkind as object_kind,
           obj_description(c.oid, 'pg_class') as description,
           case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) else pg_get_tabledef(c.oid) end as definition
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in (${schemaFilterSql})
           and c.relkind in ('r', 'p', 'f', 'v', 'm')
         order by n.nspname, c.relname`,
      ).catch(async () =>
        execute(
          engine,
          connection.id,
          `select
             n.nspname as schema_name,
             c.relname as object_name,
             c.relkind as object_kind,
             obj_description(c.oid, 'pg_class') as description,
             case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) else null end as definition
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in (${schemaFilterSql})
             and c.relkind in ('r', 'p', 'f', 'v', 'm')
           order by n.nspname, c.relname`,
        ),
      ),
      execute(
        engine,
        connection.id,
        `select
           n.nspname as schema_name,
           c.relname as table_name,
           a.attname as column_name,
           format_type(a.atttypid, a.atttypmod) as data_type,
           not a.attnotnull as is_nullable,
           pg_get_expr(ad.adbin, ad.adrelid) as default_value,
           col_description(a.attrelid, a.attnum) as description
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
         where n.nspname in (${schemaFilterSql})
           and c.relkind in ('r', 'p', 'f')
           and a.attnum > 0
           and not a.attisdropped
         order by n.nspname, c.relname, a.attnum`,
      ),
      execute(
        engine,
        connection.id,
        `select
           n.nspname as schema_name,
           c.relname as table_name,
           con.conname as constraint_name,
           con.contype as constraint_type,
           pg_get_constraintdef(con.oid, true) as definition
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in (${schemaFilterSql})
         order by n.nspname, c.relname, con.conname`,
      ),
      execute(
        engine,
        connection.id,
        `select schemaname as schema_name, tablename as table_name, indexname as index_name, indexdef as index_definition
         from pg_indexes
         where schemaname in (${schemaFilterSql})
         order by schemaname, tablename, indexname`,
      ),
      execute(
        engine,
        connection.id,
        `select
           event_object_schema as schema_name,
           event_object_table as table_name,
           trigger_name,
           action_timing,
           string_agg(distinct event_manipulation, ', ' order by event_manipulation) as events,
           action_statement
         from information_schema.triggers
         where trigger_schema in (${schemaFilterSql})
         group by event_object_schema, event_object_table, trigger_name, action_timing, action_statement
         order by event_object_schema, event_object_table, trigger_name`,
      ),
      execute(
        engine,
        connection.id,
        `select
           n.nspname as schema_name,
           p.proname as routine_name,
           p.prokind as routine_kind,
           pg_get_function_identity_arguments(p.oid) as arguments,
           case when p.prokind = 'p' then null else pg_get_function_result(p.oid) end as return_type,
           obj_description(p.oid, 'pg_proc') as description
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in (${schemaFilterSql})
           and p.prokind in ('f', 'p')
         order by n.nspname, p.proname`,
      ),
      execute(
        engine,
        connection.id,
        `select sequence_schema as schema_name, sequence_name, data_type, start_value, minimum_value, maximum_value, increment, cycle_option
         from information_schema.sequences
         where sequence_schema in (${schemaFilterSql})
         order by sequence_schema, sequence_name`,
      ),
      execute(
        engine,
        connection.id,
        `select n.nspname as schema_name, t.typname as type_name, e.enumlabel as enum_value
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         join pg_enum e on e.enumtypid = t.oid
         where n.nspname in (${schemaFilterSql})
         order by n.nspname, t.typname, e.enumsortorder`,
      ),
    ]);

  relationRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    const relkind = normalizeString(row.object_kind);
    const definition = normalizeNullableString(row.definition);

    if (relkind === "r" || relkind === "p" || relkind === "f") {
      schema.tables.push({
        name: normalizeString(row.object_name),
        kind: relkind === "r" ? "table" : relkind === "p" ? "partitioned-table" : "foreign-table",
        description: normalizeNullableString(row.description),
        definition,
        columns: [],
        constraints: [],
        indexes: [],
        triggers: [],
      });
      return;
    }

    schema.views.push({
      name: normalizeString(row.object_name),
      kind: relkind === "m" ? "materialized-view" : "view",
      description: normalizeNullableString(row.description),
      definition,
    });
  });

  const tableLookup = getTableLookup(data);

  columnRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.columns.push({
      name: normalizeString(row.column_name),
      dataType: normalizeString(row.data_type),
      nullable: Boolean(row.is_nullable),
      defaultValue: normalizeNullableString(row.default_value),
      description: normalizeNullableString(row.description),
    });
  });

  constraintRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.constraints.push({
      name: normalizeString(row.constraint_name),
      type: postgresConstraintType(normalizeString(row.constraint_type)),
      definition: normalizeString(row.definition),
    });
  });

  indexRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.indexes.push({
      name: normalizeString(row.index_name),
      definition: normalizeString(row.index_definition),
    });
  });

  triggerRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.triggers.push({
      name: normalizeString(row.trigger_name),
      timing: normalizeString(row.action_timing),
      events: normalizeString(row.events)
        .split(",")
        .map((eventName) => eventName.trim())
        .filter((eventName) => eventName.length > 0),
      action: normalizeString(row.action_statement),
    });
  });

  routineRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    schema.routines.push({
      name: normalizeString(row.routine_name),
      kind: normalizeString(row.routine_kind) === "p" ? "procedure" : "function",
      arguments: normalizeString(row.arguments),
      returnType: normalizeNullableString(row.return_type),
      description: normalizeNullableString(row.description),
    });
  });

  sequenceRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    schema.sequences.push({
      name: normalizeString(row.sequence_name),
      dataType: normalizeString(row.data_type),
      startValue: normalizeString(row.start_value),
      minimumValue: normalizeString(row.minimum_value),
      maximumValue: normalizeNullableString(row.maximum_value),
      increment: normalizeString(row.increment),
      cycle: normalizeString(row.cycle_option).toUpperCase() === "YES",
    });
  });

  const enumLookup = new Map<string, ExportedSchemaEnumType>();
  enumRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    const key = `${schema.name}.${normalizeString(row.type_name)}`;
    let entry = enumLookup.get(key);

    if (!entry) {
      entry = {
        name: normalizeString(row.type_name),
        values: [],
      };
      enumLookup.set(key, entry);
      schema.enumTypes.push(entry);
    }

    entry.values.push(normalizeString(row.enum_value));
  });

  return data;
}

function buildMySqlConstraintDefinition(row: Record<string, unknown>): string {
  const type = normalizeString(row.constraint_type);
  const columns = normalizeString(row.column_names);
  const referencedTable = normalizeNullableString(row.referenced_table_name);
  const referencedColumns = normalizeNullableString(row.referenced_column_names);

  if (type === "PRIMARY KEY") {
    return `PRIMARY KEY (${columns})`;
  }

  if (type === "UNIQUE") {
    return `UNIQUE (${columns})`;
  }

  if (type === "FOREIGN KEY") {
    const referencedSchema = normalizeNullableString(row.referenced_schema_name);
    const targetTable = referencedSchema ? `${referencedSchema}.${referencedTable}` : referencedTable;
    return `FOREIGN KEY (${columns}) REFERENCES ${targetTable ?? "unknown"} (${referencedColumns ?? ""})`;
  }

  return type;
}

async function exportMySqlSchema(
  engine: QueryEngine,
  connection: SupportedConnectionProfile,
  schemaNames: string[],
): Promise<ExportedDatabaseSchema> {
  const data = createBaseExport(connection, schemaNames);
  const schemaMap = getSchemaGroupMap(data);
  const schemaFilterSql = buildSchemaFilterSql(schemaNames);
  const [tableRows, viewRows, columnRows, keyConstraintRows, checkConstraintRows, indexRows, triggerRows, routineRows] =
    await Promise.all([
      execute(
        engine,
        connection.id,
        `select table_schema as schema_name, table_name, table_type, table_comment as description
         from information_schema.tables
         where table_schema in (${schemaFilterSql}) and table_type = 'BASE TABLE'
         order by table_schema, table_name`,
      ),
      execute(
        engine,
        connection.id,
        `select v.table_schema as schema_name, v.table_name, v.view_definition
         from information_schema.views v
         where v.table_schema in (${schemaFilterSql})
         order by v.table_schema, v.table_name`,
      ),
      execute(
        engine,
        connection.id,
        `select table_schema as schema_name, table_name, column_name, column_type as data_type,
                is_nullable = 'YES' as is_nullable, column_default as default_value, column_comment as description
         from information_schema.columns
         where table_schema in (${schemaFilterSql})
         order by table_schema, table_name, ordinal_position`,
      ),
      execute(
        engine,
        connection.id,
        `select tc.table_schema as schema_name, tc.table_name, tc.constraint_name, tc.constraint_type,
                group_concat(kcu.column_name order by kcu.ordinal_position separator ', ') as column_names,
                max(kcu.referenced_table_schema) as referenced_schema_name,
                max(kcu.referenced_table_name) as referenced_table_name,
                group_concat(kcu.referenced_column_name order by kcu.ordinal_position separator ', ') as referenced_column_names
         from information_schema.table_constraints tc
         left join information_schema.key_column_usage kcu
           on tc.constraint_schema = kcu.constraint_schema
          and tc.table_name = kcu.table_name
          and tc.constraint_name = kcu.constraint_name
         where tc.table_schema in (${schemaFilterSql})
           and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
         group by tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type
         order by tc.table_schema, tc.table_name, tc.constraint_name`,
      ),
      execute(
        engine,
        connection.id,
        `select tc.table_schema as schema_name, tc.table_name, tc.constraint_name, cc.check_clause
         from information_schema.table_constraints tc
         join information_schema.check_constraints cc
           on tc.constraint_schema = cc.constraint_schema
          and tc.constraint_name = cc.constraint_name
         where tc.table_schema in (${schemaFilterSql})
           and tc.constraint_type = 'CHECK'
         order by tc.table_schema, tc.table_name, tc.constraint_name`,
      ).catch(() => []),
      execute(
        engine,
        connection.id,
        `select table_schema as schema_name, table_name, index_name,
                concat(case when non_unique = 0 then 'UNIQUE ' else '' end, index_type, ' (',
                       group_concat(column_name order by seq_in_index separator ', '), ')') as index_definition
         from information_schema.statistics
         where table_schema in (${schemaFilterSql})
         group by table_schema, table_name, index_name, non_unique, index_type
         order by table_schema, table_name, index_name`,
      ),
      execute(
        engine,
        connection.id,
        `select trigger_schema as schema_name, event_object_table as table_name, trigger_name,
                action_timing, event_manipulation, action_statement
         from information_schema.triggers
         where trigger_schema in (${schemaFilterSql})
         order by trigger_schema, event_object_table, trigger_name`,
      ),
      execute(
        engine,
        connection.id,
        `select routine_schema as schema_name, routine_name, lower(routine_type) as routine_kind,
                dtd_identifier as return_type, routine_definition
         from information_schema.routines
         where routine_schema in (${schemaFilterSql})
         order by routine_schema, routine_name`,
      ).catch(() => []),
    ]);

  tableRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    schema.tables.push({
      name: normalizeString(row.table_name),
      kind: "table",
      description: normalizeNullableString(row.description),
      definition: null,
      columns: [],
      constraints: [],
      indexes: [],
      triggers: [],
    });
  });

  viewRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    schema.views.push({
      name: normalizeString(row.table_name),
      kind: "view",
      description: null,
      definition: normalizeNullableString(row.view_definition),
    });
  });

  const tableLookup = getTableLookup(data);

  columnRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.columns.push({
      name: normalizeString(row.column_name),
      dataType: normalizeString(row.data_type),
      nullable: Boolean(row.is_nullable),
      defaultValue: normalizeNullableString(row.default_value),
      description: normalizeNullableString(row.description),
    });
  });

  keyConstraintRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.constraints.push({
      name: normalizeString(row.constraint_name),
      type: normalizeString(row.constraint_type).toLowerCase().replace(/\s+/g, "-"),
      definition: buildMySqlConstraintDefinition(row),
    });
  });

  checkConstraintRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.constraints.push({
      name: normalizeString(row.constraint_name),
      type: "check",
      definition: `CHECK (${normalizeString(row.check_clause)})`,
    });
  });

  indexRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.indexes.push({
      name: normalizeString(row.index_name),
      definition: normalizeString(row.index_definition),
    });
  });

  triggerRows.forEach((row) => {
    const table = tableLookup.get(`${normalizeString(row.schema_name)}.${normalizeString(row.table_name)}`);

    if (!table) {
      return;
    }

    table.triggers.push({
      name: normalizeString(row.trigger_name),
      timing: normalizeString(row.action_timing),
      events: [normalizeString(row.event_manipulation)].filter((eventName) => eventName.length > 0),
      action: normalizeString(row.action_statement),
    });
  });

  routineRows.forEach((row) => {
    const schema = schemaMap.get(normalizeString(row.schema_name));

    if (!schema) {
      return;
    }

    schema.routines.push({
      name: normalizeString(row.routine_name),
      kind: normalizeString(row.routine_kind) || "routine",
      arguments: "",
      returnType: normalizeNullableString(row.return_type),
      description: normalizeNullableString(row.routine_definition),
    });
  });

  return data;
}

function escapeSqliteIdentifier(value: string): string {
  return value.replace(/"/g, '""');
}

function formatSqliteIndexDefinition(
  indexName: string,
  isUnique: boolean,
  columns: string[],
): string {
  return `${isUnique ? "UNIQUE " : ""}INDEX ${indexName} (${columns.join(", ")})`;
}

async function exportSqliteSchema(
  engine: QueryEngine,
  connection: SupportedConnectionProfile,
  schemaNames: string[],
): Promise<ExportedDatabaseSchema> {
  const data = createBaseExport(connection, schemaNames);
  const schemaMap = getSchemaGroupMap(data);

  for (const schemaName of schemaNames) {
    const schema = schemaMap.get(schemaName);

    if (!schema) {
      continue;
    }

    const escapedSchema = escapeSqliteIdentifier(schemaName);
    const relationRows = await execute(
      engine,
      connection.id,
      `select type, name, sql
       from "${escapedSchema}".sqlite_master
       where type in ('table', 'view')
         and name not like 'sqlite_%'
       order by type, name`,
    );
    const triggerRows = await execute(
      engine,
      connection.id,
      `select tbl_name as table_name, name as trigger_name, sql
       from "${escapedSchema}".sqlite_master
       where type = 'trigger'
       order by tbl_name, name`,
    );

    relationRows.forEach((row) => {
      const type = normalizeString(row.type);

      if (type === "table") {
        schema.tables.push({
          name: normalizeString(row.name),
          kind: "table",
          description: null,
          definition: normalizeNullableString(row.sql),
          columns: [],
          constraints: [],
          indexes: [],
          triggers: [],
        });
        return;
      }

      schema.views.push({
        name: normalizeString(row.name),
        kind: "view",
        description: null,
        definition: normalizeNullableString(row.sql),
      });
    });

    const tableLookup = getTableLookup(data);

    for (const table of schema.tables) {
      const escapedTable = escapeSqliteIdentifier(table.name);
      const columnRows = await execute(
        engine,
        connection.id,
        `pragma "${escapedSchema}".table_info("${escapedTable}")`,
      );
      const foreignKeyRows = await execute(
        engine,
        connection.id,
        `pragma "${escapedSchema}".foreign_key_list("${escapedTable}")`,
      );
      const indexListRows = await execute(
        engine,
        connection.id,
        `pragma "${escapedSchema}".index_list("${escapedTable}")`,
      );

      columnRows.forEach((row) => {
        table.columns.push({
          name: normalizeString(row.name),
          dataType: normalizeString(row.type),
          nullable: Number(row.notnull ?? 0) === 0,
          defaultValue: normalizeNullableString(row.dflt_value),
          description: null,
        });
      });

      const primaryKeyColumns = columnRows
        .filter((row) => Number(row.pk ?? 0) > 0)
        .sort((left, right) => Number(left.pk ?? 0) - Number(right.pk ?? 0))
        .map((row) => normalizeString(row.name));

      if (primaryKeyColumns.length > 0) {
        table.constraints.push({
          name: `${table.name}_pk`,
          type: "primary-key",
          definition: `PRIMARY KEY (${primaryKeyColumns.join(", ")})`,
        });
      }

      const foreignKeyGroups = new Map<string, Array<Record<string, unknown>>>();
      foreignKeyRows.forEach((row) => {
        const key = normalizeString(row.id);
        const group = foreignKeyGroups.get(key) ?? [];
        group.push(row);
        foreignKeyGroups.set(key, group);
      });

      foreignKeyGroups.forEach((group, key) => {
        const ordered = [...group].sort((left, right) => Number(left.seq ?? 0) - Number(right.seq ?? 0));
        const sourceColumns = ordered.map((row) => normalizeString(row.from));
        const targetColumns = ordered.map((row) => normalizeString(row.to));
        const targetTable = normalizeString(ordered[0]?.table);
        table.constraints.push({
          name: `${table.name}_fk_${key}`,
          type: "foreign-key",
          definition: `FOREIGN KEY (${sourceColumns.join(", ")}) REFERENCES ${targetTable} (${targetColumns.join(", ")})`,
        });
      });

      for (const indexRow of indexListRows) {
        const indexName = normalizeString(indexRow.name);
        const indexInfoRows = await execute(
          engine,
          connection.id,
          `pragma "${escapedSchema}".index_info("${escapeSqliteIdentifier(indexName)}")`,
        );
        const columns = indexInfoRows
          .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
          .map((row) => normalizeString(row.name))
          .filter((name) => name.length > 0);
        const isUnique = Number(indexRow.unique ?? 0) === 1;
        const origin = normalizeString(indexRow.origin);
        const definition = formatSqliteIndexDefinition(indexName, isUnique, columns);

        table.indexes.push({
          name: indexName,
          definition,
        });

        if (isUnique && origin !== "pk") {
          table.constraints.push({
            name: indexName,
            type: "unique",
            definition: `UNIQUE (${columns.join(", ")})`,
          });
        }
      }

      const lookupTable = tableLookup.get(`${schemaName}.${table.name}`);
      if (lookupTable) {
        triggerRows
          .filter((row) => normalizeString(row.table_name) === table.name)
          .forEach((row) => {
            lookupTable.triggers.push({
              name: normalizeString(row.trigger_name),
              timing: "custom",
              events: [],
              action: normalizeString(row.sql),
            });
          });
      }
    }
  }

  return data;
}

export async function exportDatabaseSchema(
  engine: QueryEngine,
  connection: ConnectionProfile,
  schemaNames: string[],
): Promise<ExportedDatabaseSchema> {
  assertExportableConnection(connection);

  if (schemaNames.length === 0) {
    throw new Error("No visible schemas are available to export for this connection.");
  }

  await engine.connect(connection);

  if (connection.target.dialect === "postgres") {
    return exportPostgresSchema(engine, connection, schemaNames);
  }

  if (connection.target.dialect === "mysql") {
    return exportMySqlSchema(engine, connection, schemaNames);
  }

  return exportSqliteSchema(engine, connection, schemaNames);
}

export function renderDatabaseSchemaMarkdown(data: ExportedDatabaseSchema): string {
  const lines: string[] = [
    `# ${data.connectionName} ${formatDialectLabel(data.dialect)} schema`,
    "",
    `- Database: ${data.databaseName}`,
    `- Exported at: ${data.exportedAt}`,
    `- Schemas: ${data.schemas.map((schema) => schema.name).join(", ") || "None"}`,
  ];

  data.schemas.forEach((schema) => {
    lines.push("", `## Schema \`${schema.name}\``);

    lines.push("", "### Tables");
    if (schema.tables.length === 0) {
      lines.push("- None");
    }

    schema.tables.forEach((table) => {
      lines.push("", `#### ${table.name}`, "", `- Kind: ${table.kind}`);
      if (table.description) {
        lines.push(`- Description: ${table.description}`);
      }
      if (table.definition) {
        lines.push("", "```sql", table.definition, "```");
      }
      lines.push("", "| Column | Type | Nullable | Default | Description |", "| --- | --- | --- | --- | --- |");
      table.columns.forEach((column) => {
        lines.push(
          `| ${escapeMarkdownCell(column.name)} | ${escapeMarkdownCell(column.dataType)} | ${column.nullable ? "yes" : "no"} | ${escapeMarkdownCell(column.defaultValue)} | ${escapeMarkdownCell(column.description)} |`,
        );
      });
      lines.push("", "Constraints");
      formatMarkdownList(
        table.constraints.map(
          (constraint) => `- ${constraint.name} [${constraint.type}]: ${constraint.definition}`,
        ),
      ).forEach((line) => lines.push(line));
      lines.push("", "Indexes");
      formatMarkdownList(
        table.indexes.map((index) => `- ${index.name}: ${index.definition}`),
      ).forEach((line) => lines.push(line));
      lines.push("", "Triggers");
      formatMarkdownList(
        table.triggers.map(
          (trigger) =>
            `- ${trigger.name}: ${trigger.timing}${trigger.events.length > 0 ? ` ${trigger.events.join(", ")}` : ""} -> ${trigger.action}`,
        ),
      ).forEach((line) => lines.push(line));
    });

    lines.push("", "### Views");
    if (schema.views.length === 0) {
      lines.push("- None");
    }
    schema.views.forEach((view) => {
      lines.push("", `#### ${view.name}`, "", `- Kind: ${view.kind}`);
      if (view.description) {
        lines.push(`- Description: ${view.description}`);
      }
      if (view.definition) {
        lines.push("", "```sql", view.definition, "```");
      }
    });

    lines.push("", "### Routines");
    formatMarkdownList(
      schema.routines.map((routine) => {
        const returnSuffix = routine.returnType ? ` -> ${routine.returnType}` : "";
        const descriptionSuffix = routine.description ? ` (${routine.description})` : "";
        return `- ${routine.kind} ${routine.name}(${routine.arguments})${returnSuffix}${descriptionSuffix}`;
      }),
    ).forEach((line) => lines.push(line));

    lines.push("", "### Sequences");
    formatMarkdownList(
      schema.sequences.map(
        (sequence) =>
          `- ${sequence.name}: ${sequence.dataType}, start ${sequence.startValue}, min ${sequence.minimumValue}, max ${sequence.maximumValue ?? "none"}, increment ${sequence.increment}, cycle ${sequence.cycle ? "yes" : "no"}`,
      ),
    ).forEach((line) => lines.push(line));

    lines.push("", "### Enum types");
    formatMarkdownList(
      schema.enumTypes.map((enumType) => `- ${enumType.name}: ${enumType.values.join(", ")}`),
    ).forEach((line) => lines.push(line));
  });

  return `${lines.join("\n")}\n`;
}

export function createSchemaExportArtifact(
  connection: ConnectionProfile,
  format: DatabaseSchemaExportFormat,
  data: ExportedDatabaseSchema,
): ExportArtifact {
  return {
    fileName: buildSchemaExportFileName(connection, format, new Date(data.exportedAt)),
    mimeType: format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
    content:
      format === "markdown"
        ? renderDatabaseSchemaMarkdown(data)
        : `${JSON.stringify(data, null, 2)}\n`,
  };
}

export function downloadSchemaExport(artifact: ExportArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
