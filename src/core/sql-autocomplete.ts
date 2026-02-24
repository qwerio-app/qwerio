import type { SchemaObjectKind, SchemaObjectMap } from "./query-engine";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCHEMA_PATTERN =
  /(?:^|[\s(,])(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))\.[A-Za-z0-9_$"]*$/;
const RELATION_KEYWORD_PATTERN =
  /\b(from|join|update|into|delete\s+from|truncate\s+table)\s+[A-Za-z0-9_."$]*$/i;
const MAX_SQL_AUTOCOMPLETE_SUGGESTIONS = 5;

const DEFAULT_OBJECT_KINDS: SchemaObjectKind[] = ["tables", "views"];

const SCHEMA_OBJECT_KIND_LABEL: Record<SchemaObjectKind, string> = {
  tables: "table",
  views: "view",
  functions: "function",
  triggers: "trigger",
  indexes: "index",
  procedures: "procedure",
  sequences: "sequence",
};

export type SqlAutocompleteSuggestionKind =
  | "schema"
  | SchemaObjectKind
  | "variable";

export type SqlAutocompleteSuggestion = {
  label: string;
  insertText: string;
  detail: string;
  kind: SqlAutocompleteSuggestionKind;
  sortText: string;
};

type BuildSqlAutocompleteSuggestionsInput = {
  schemaObjectMap: Record<string, SchemaObjectMap>;
  sql: string;
  linePrefix: string;
  wordUntilCursor: string;
};

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase();
}

function resolveSchemaName(
  schemaObjectMap: Record<string, SchemaObjectMap>,
  schemaName: string,
): string | null {
  const lookup = normalizeLookup(schemaName);

  for (const currentSchemaName of Object.keys(schemaObjectMap)) {
    if (normalizeLookup(currentSchemaName) === lookup) {
      return currentSchemaName;
    }
  }

  return null;
}

function detectQualifiedSchema(linePrefix: string): string | null {
  const match = SCHEMA_PATTERN.exec(linePrefix);
  const resolvedName = (match?.[1] ?? match?.[2] ?? "").trim();
  return resolvedName.length > 0 ? resolvedName : null;
}

function shouldIncludeSuggestion(
  label: string,
  wordUntilCursor: string,
): boolean {
  const lookup = normalizeLookup(wordUntilCursor);

  if (lookup.length === 0) {
    return true;
  }

  return normalizeLookup(label).includes(lookup);
}

function tryAddVariableName(
  names: Set<string>,
  rawName: string | undefined,
): void {
  const normalized = (rawName ?? "").trim();

  if (!IDENTIFIER_PATTERN.test(normalized)) {
    return;
  }

  names.add(normalized);
}

export function extractSqlVariableNames(sql: string): string[] {
  const names = new Set<string>();

  for (const match of sql.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    tryAddVariableName(names, match[1]);
  }

  for (const match of sql.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    tryAddVariableName(names, match[1]);
  }

  for (const match of sql.matchAll(/[@:][A-Za-z_][A-Za-z0-9_]*/g)) {
    const token = match[0];
    const tokenStart = match.index ?? 0;

    if (token.startsWith(":") && tokenStart > 0 && sql[tokenStart - 1] === ":") {
      continue;
    }

    tryAddVariableName(names, token.slice(1));
  }

  for (const match of sql.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*/g)) {
    const token = match[0];
    const tokenStart = match.index ?? 0;

    if (tokenStart + 1 < sql.length && sql[tokenStart + 1] === "{") {
      continue;
    }

    tryAddVariableName(names, token.slice(1));
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function buildSchemaSuggestions(
  schemaObjectMap: Record<string, SchemaObjectMap>,
  wordUntilCursor: string,
  sortBucket: string,
): SqlAutocompleteSuggestion[] {
  const suggestions: SqlAutocompleteSuggestion[] = [];

  Object.keys(schemaObjectMap)
    .sort((left, right) => left.localeCompare(right))
    .forEach((schemaName) => {
      if (!shouldIncludeSuggestion(schemaName, wordUntilCursor)) {
        return;
      }

      suggestions.push({
        label: schemaName,
        insertText: schemaName,
        detail: "schema",
        kind: "schema",
        sortText: `${sortBucket}_schema_${schemaName.toLowerCase()}`,
      });
    });

  return suggestions;
}

function buildObjectSuggestionsForSchema(
  schemaName: string,
  objectMap: SchemaObjectMap,
  input: {
    allowedKinds: SchemaObjectKind[];
    qualified: boolean;
    unqualifiedNameCount: Map<string, number>;
    wordUntilCursor: string;
  },
): SqlAutocompleteSuggestion[] {
  const suggestions: SqlAutocompleteSuggestion[] = [];

  input.allowedKinds.forEach((kind) => {
    const kindLabel = SCHEMA_OBJECT_KIND_LABEL[kind];
    const objects = objectMap[kind];

    objects.forEach((schemaObject) => {
      const objectName = schemaObject.name.trim();

      if (objectName.length === 0) {
        return;
      }

      if (input.qualified) {
        if (!shouldIncludeSuggestion(objectName, input.wordUntilCursor)) {
          return;
        }

        suggestions.push({
          label: objectName,
          insertText: objectName,
          detail: `${kindLabel} • ${schemaName}`,
          kind,
          sortText: `2_${kind}_${objectName.toLowerCase()}`,
        });

        return;
      }

      const qualifiedLabel = `${schemaName}.${objectName}`;

      if (shouldIncludeSuggestion(qualifiedLabel, input.wordUntilCursor)) {
        suggestions.push({
          label: qualifiedLabel,
          insertText: qualifiedLabel,
          detail: `${kindLabel} • ${schemaName}`,
          kind,
          sortText: `2_${kind}_${qualifiedLabel.toLowerCase()}`,
        });
      }

      const countKey = `${kind}:${objectName.toLowerCase()}`;
      const objectNameCount = input.unqualifiedNameCount.get(countKey) ?? 0;

      if (objectNameCount !== 1) {
        return;
      }

      if (!shouldIncludeSuggestion(objectName, input.wordUntilCursor)) {
        return;
      }

      suggestions.push({
        label: objectName,
        insertText: objectName,
        detail: `${kindLabel} • ${schemaName}`,
        kind,
        sortText: `3_${kind}_${objectName.toLowerCase()}`,
      });
    });
  });

  return suggestions;
}

function countUnqualifiedObjectNames(
  schemaObjectMap: Record<string, SchemaObjectMap>,
  allowedKinds: SchemaObjectKind[],
): Map<string, number> {
  const counts = new Map<string, number>();

  Object.values(schemaObjectMap).forEach((objectMap) => {
    allowedKinds.forEach((kind) => {
      objectMap[kind].forEach((schemaObject) => {
        const objectName = schemaObject.name.trim();

        if (objectName.length === 0) {
          return;
        }

        const key = `${kind}:${objectName.toLowerCase()}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    });
  });

  return counts;
}

function buildVariableSuggestions(
  sql: string,
  wordUntilCursor: string,
): SqlAutocompleteSuggestion[] {
  return extractSqlVariableNames(sql)
    .filter((name) => shouldIncludeSuggestion(name, wordUntilCursor))
    .map((name) => ({
      label: name,
      insertText: name,
      detail: "query variable",
      kind: "variable" as const,
      sortText: `1_variable_${name.toLowerCase()}`,
    }));
}

function dedupeSuggestions(
  suggestions: SqlAutocompleteSuggestion[],
): SqlAutocompleteSuggestion[] {
  const seen = new Set<string>();
  const deduped: SqlAutocompleteSuggestion[] = [];

  suggestions.forEach((suggestion) => {
    const dedupeKey = `${suggestion.kind}:${suggestion.label}:${suggestion.insertText}`;

    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    deduped.push(suggestion);
  });

  return deduped;
}

function isRelationContext(linePrefix: string): boolean {
  return RELATION_KEYWORD_PATTERN.test(linePrefix.trimEnd());
}

export function buildSqlAutocompleteSuggestions(
  input: BuildSqlAutocompleteSuggestionsInput,
): SqlAutocompleteSuggestion[] {
  const normalizedWord = input.wordUntilCursor.trim();
  const suggestions: SqlAutocompleteSuggestion[] = [];
  const qualifiedSchemaInput = detectQualifiedSchema(input.linePrefix);
  const relationContext = isRelationContext(input.linePrefix);
  const allowedKinds = DEFAULT_OBJECT_KINDS;

  if (qualifiedSchemaInput) {
    const schemaName = resolveSchemaName(input.schemaObjectMap, qualifiedSchemaInput);

    if (schemaName) {
      const objectMap = input.schemaObjectMap[schemaName];

      suggestions.push(
        ...buildObjectSuggestionsForSchema(schemaName, objectMap, {
          allowedKinds,
          qualified: true,
          unqualifiedNameCount: new Map<string, number>(),
          wordUntilCursor: normalizedWord,
        }),
      );
    }
  } else {
    const unqualifiedNameCount = countUnqualifiedObjectNames(
      input.schemaObjectMap,
      allowedKinds,
    );

    suggestions.push(
      ...buildSchemaSuggestions(
        input.schemaObjectMap,
        normalizedWord,
        relationContext ? "3" : "4",
      ),
    );

    Object.keys(input.schemaObjectMap)
      .sort((left, right) => left.localeCompare(right))
      .forEach((schemaName) => {
        suggestions.push(
          ...buildObjectSuggestionsForSchema(
            schemaName,
            input.schemaObjectMap[schemaName],
            {
              allowedKinds,
              qualified: false,
              unqualifiedNameCount,
              wordUntilCursor: normalizedWord,
            },
          ),
        );
      });
  }

  if (!relationContext) {
    suggestions.push(...buildVariableSuggestions(input.sql, normalizedWord));
  }

  return dedupeSuggestions(suggestions)
    .sort((left, right) => {
      if (left.sortText === right.sortText) {
        return left.label.localeCompare(right.label);
      }

      return left.sortText.localeCompare(right.sortText);
    })
    .slice(0, MAX_SQL_AUTOCOMPLETE_SUGGESTIONS);
}
