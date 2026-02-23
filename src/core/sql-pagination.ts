import type { DbDialect } from "./types";

export function stripTrailingSemicolons(sql: string): string {
  return sql.trim().replace(/;+$/g, "").trim();
}

export function isLikelyTabularQuery(sql: string): boolean {
  const normalized = stripTrailingSemicolons(sql).toLowerCase();

  return /^(select|with)\b/.test(normalized);
}

export function buildPaginatedSql(input: {
  dialect: DbDialect;
  sql: string;
  page: number;
  pageSize: number;
  fetchExtraRow?: boolean;
}): string {
  const normalizedSql = stripTrailingSemicolons(input.sql);
  const normalizedPage = Number.isFinite(input.page)
    ? Math.max(1, Math.floor(input.page))
    : 1;
  const normalizedPageSize = Number.isFinite(input.pageSize)
    ? Math.max(1, Math.floor(input.pageSize))
    : 1;
  const limit = input.fetchExtraRow
    ? normalizedPageSize + 1
    : normalizedPageSize;
  const offset = (normalizedPage - 1) * normalizedPageSize;

  if (input.dialect === "sqlserver") {
    return `select * from (${normalizedSql}) as qwerio_page order by (select null) offset ${offset} rows fetch next ${limit} rows only`;
  }

  return `select * from (${normalizedSql}) as qwerio_page limit ${limit} offset ${offset}`;
}

export function clampPageSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(5_000, Math.max(1, Math.floor(value)));
}
