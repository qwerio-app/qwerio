<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Copy, Filter, Plus, RefreshCcw, RotateCcw, Trash2 } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import ResultsGrid from '../components/workbench/ResultsGrid.vue'
import { createNanoId } from '../core/nano-id'
import { getQueryEngine } from '../core/query-engine-service'
import { clampPageSize, buildPaginatedSql } from '../core/sql-pagination'
import { SecretPinRequiredError } from '../core/secret-vault'
import type { ConnectionProfile, DesktopPostgresTlsMode, QueryResult } from '../core/types'
import { useAppSettingsStore } from '../stores/app-settings'
import { useConnectionsStore } from '../stores/connections'
import { useVaultStore } from '../stores/vault'
import { useWorkbenchStore } from '../stores/workbench'

type GridCellEditedPayload = {
  rowIndex: number
  column: string
  oldValue: unknown
  newValue: unknown
  rowData: Record<string, unknown>
}

type PendingCellEdit = {
  key: string
  rowKey: string
  column: string
  oldValue: unknown
  newValue: unknown
  primaryKeyValues: Record<string, unknown>
}

type PendingInsertedRow = {
  id: string
  values: Record<string, unknown>
}

type PendingDeletedRow = {
  key: string
  rowKey: string
  primaryKeyValues: Record<string, unknown>
}

type TableGridRow = Record<string, unknown> & {
  __qwerioRowId: string
  __qwerioRowKind: 'existing' | 'insert'
  __qwerioDraftId?: string
  __qwerioRowKey?: string
}

const DEFAULT_PAGE_SIZE = 200

const route = useRoute()
const appSettingsStore = useAppSettingsStore()
const connectionsStore = useConnectionsStore()
const vaultStore = useVaultStore()
const workbenchStore = useWorkbenchStore()

const isLoading = ref(false)
const isSavingChanges = ref(false)
const errorMessage = ref('')
const result = ref<QueryResult | null>(null)
const paginationPage = ref(1)
const hasNextPage = ref(false)
const totalRows = ref<number | null>(null)
const primaryKeyColumns = ref<string[]>([])
const primaryKeyLookupKey = ref('')
const pendingEditsByKey = ref<Record<string, PendingCellEdit>>({})
const pendingInsertedRows = ref<PendingInsertedRow[]>([])
const pendingDeletedRowsByKey = ref<Record<string, PendingDeletedRow>>({})
const selectedRowIds = ref<string[]>([])
const activeRowId = ref('')

const filters = reactive({
  whereClause: '',
  orderBy: '',
})

const resolvedPageSize = computed(() =>
  clampPageSize(appSettingsStore.resultsPageSize, DEFAULT_PAGE_SIZE)
)

const tableTabId = computed(() =>
  typeof route.params.tableTabId === 'string' ? route.params.tableTabId : ''
)

const tableTab = computed(() => {
  if (!tableTabId.value) {
    return null
  }

  return workbenchStore.getTableTab(tableTabId.value)
})

const connectionProfile = computed<ConnectionProfile | null>(() => {
  if (!tableTab.value) {
    return null
  }

  return (
    connectionsStore.profiles.find((profile) => profile.id === tableTab.value?.connectionId) ?? null
  )
})

function applyResolvedDesktopTlsMode(
  connection: ConnectionProfile,
  connectResult: { resolvedDesktopTlsMode?: DesktopPostgresTlsMode }
): void {
  if (
    connection.target.kind !== 'desktop-tcp' ||
    connection.target.dialect !== 'postgres' ||
    !connectResult.resolvedDesktopTlsMode
  ) {
    return
  }

  connectionsStore.setDesktopPostgresTlsMode(connection.id, connectResult.resolvedDesktopTlsMode)
}

const tableTitle = computed(() => {
  if (!tableTab.value) {
    return 'Unknown object'
  }

  return tableTab.value.tableName
})

const tableObjectType = computed(() => tableTab.value?.objectType ?? 'table')
const isReadOnlyView = computed(() => tableObjectType.value === 'view')
const objectLabel = computed(() => (isReadOnlyView.value ? 'view' : 'table'))
const hasPrimaryKey = computed(() => primaryKeyColumns.value.length > 0)
const canInlineEdit = computed(() => !isReadOnlyView.value && hasPrimaryKey.value)
const canEditGrid = computed(() => !isReadOnlyView.value)
const pendingEdits = computed(() => Object.values(pendingEditsByKey.value))
const pendingEditCount = computed(() => pendingEdits.value.length)
const pendingInsertCount = computed(() => pendingInsertedRows.value.length)
const pendingDeleteCount = computed(() => Object.keys(pendingDeletedRowsByKey.value).length)
const totalPendingChangeCount = computed(
  () => pendingEditCount.value + pendingInsertCount.value + pendingDeleteCount.value
)
const hasPendingChanges = computed(() => totalPendingChangeCount.value > 0)
const pendingChangesStatusLabel = computed(() => {
  const segments = [
    pendingInsertCount.value > 0
      ? `${pendingInsertCount.value} insert${pendingInsertCount.value === 1 ? '' : 's'}`
      : '',
    pendingDeleteCount.value > 0
      ? `${pendingDeleteCount.value} delete${pendingDeleteCount.value === 1 ? '' : 's'}`
      : '',
    pendingEditCount.value > 0
      ? `${pendingEditCount.value} update${pendingEditCount.value === 1 ? '' : 's'}`
      : '',
  ].filter((segment) => segment.length > 0)

  return segments.length > 0 ? segments.join(' · ') : 'No changes'
})
const gridPagination = computed(() =>
  result.value
    ? {
        page: paginationPage.value,
        pageSize: resolvedPageSize.value,
        canPrevious: paginationPage.value > 1,
        canNext: hasNextPage.value,
        totalRows: totalRows.value,
        isLoading: isLoading.value || isSavingChanges.value,
      }
    : null
)

function quoteIdentifier(
  dialect: ConnectionProfile['target']['dialect'],
  identifier: string
): string {
  if (dialect === 'mysql') {
    return '`' + identifier.replace(/`/g, '``') + '`'
  }

  if (dialect === 'sqlserver') {
    return `[${identifier.replace(/]/g, ']]')}]`
  }

  return `"${identifier.replace(/"/g, '""')}"`
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function toSqlLiteral(dialect: ConnectionProfile['target']['dialect'], value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null'
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'boolean') {
    if (dialect === 'sqlserver' || dialect === 'mysql') {
      return value ? '1' : '0'
    }

    return value ? 'true' : 'false'
  }

  if (typeof value === 'object') {
    return quoteString(JSON.stringify(value))
  }

  return quoteString(String(value))
}

function buildFromClause(profile: ConnectionProfile): string {
  if (!tableTab.value) {
    return ''
  }

  const schema = quoteIdentifier(profile.target.dialect, tableTab.value.schemaName)
  const table = quoteIdentifier(profile.target.dialect, tableTab.value.tableName)

  return `${schema}.${table}`
}

function buildBaseSelectSql(profile: ConnectionProfile): string {
  const fromClause = buildFromClause(profile)
  let sql = `select * from ${fromClause}`

  if (filters.whereClause.trim()) {
    sql += ` where ${filters.whereClause.trim()}`
  }

  if (filters.orderBy.trim()) {
    sql += ` order by ${filters.orderBy.trim()}`
  }

  return sql
}

function buildCountSql(profile: ConnectionProfile): string {
  const fromClause = buildFromClause(profile)
  let sql = `select count(*) as total_count from ${fromClause}`

  if (filters.whereClause.trim()) {
    sql += ` where ${filters.whereClause.trim()}`
  }

  return sql
}

function buildPrimaryKeyWhereSql(
  profile: ConnectionProfile,
  primaryKeyValues: Record<string, unknown>
): string {
  return primaryKeyColumns.value
    .map(
      (primaryKeyColumn) =>
        `${quoteIdentifier(profile.target.dialect, primaryKeyColumn)} = ${toSqlLiteral(profile.target.dialect, primaryKeyValues[primaryKeyColumn])}`
    )
    .join(' and ')
}

function buildInsertSql(profile: ConnectionProfile, values: Record<string, unknown>): string {
  const fromClause = buildFromClause(profile)
  const entries = (result.value?.columns ?? [])
    .map((column) => [column.name, values[column.name]] as const)
    .filter((entry) => entry[1] !== undefined)

  if (entries.length === 0) {
    if (profile.target.dialect === 'mysql') {
      return `insert into ${fromClause} () values ()`
    }

    return `insert into ${fromClause} default values`
  }

  const columnSql = entries
    .map(([column]) => quoteIdentifier(profile.target.dialect, column))
    .join(', ')
  const valueSql = entries
    .map(([, value]) => toSqlLiteral(profile.target.dialect, value))
    .join(', ')

  return `insert into ${fromClause} (${columnSql}) values (${valueSql})`
}

function getPrimaryKeyMetadataSql(profile: ConnectionProfile): string {
  if (!tableTab.value) {
    return ''
  }

  const schemaName = tableTab.value.schemaName
  const tableName = tableTab.value.tableName

  if (profile.target.dialect === 'postgres') {
    return `select kcu.column_name as name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema = ${quoteString(schemaName)}
  and tc.table_name = ${quoteString(tableName)}
order by kcu.ordinal_position`
  }

  if (profile.target.dialect === 'mysql') {
    return `select kcu.column_name as name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema = ${quoteString(schemaName)}
  and tc.table_name = ${quoteString(tableName)}
order by kcu.ordinal_position`
  }

  if (profile.target.dialect === 'sqlserver') {
    return `select c.name as name
from sys.key_constraints kc
join sys.index_columns ic
  on kc.parent_object_id = ic.object_id
 and kc.unique_index_id = ic.index_id
join sys.columns c
  on c.object_id = ic.object_id
 and c.column_id = ic.column_id
join sys.tables t
  on t.object_id = kc.parent_object_id
join sys.schemas s
  on s.schema_id = t.schema_id
where kc.type = 'PK'
  and s.name = ${quoteString(schemaName)}
  and t.name = ${quoteString(tableName)}
order by ic.key_ordinal`
  }

  return `pragma ${quoteIdentifier(profile.target.dialect, schemaName)}.table_info(${quoteIdentifier(profile.target.dialect, tableName)})`
}

function parsePrimaryKeyColumns(profile: ConnectionProfile, pkResult: QueryResult): string[] {
  if (profile.target.dialect === 'sqlite') {
    return pkResult.rows
      .filter((row) => Number(row.pk ?? 0) > 0)
      .sort((left, right) => Number(left.pk ?? 0) - Number(right.pk ?? 0))
      .map((row) => String(row.name ?? '').trim())
      .filter((name) => name.length > 0)
  }

  return pkResult.rows
    .map((row) => String(row.name ?? row.column_name ?? '').trim())
    .filter((name) => name.length > 0)
}

async function loadPrimaryKeyColumns(profile: ConnectionProfile): Promise<void> {
  if (!tableTab.value) {
    primaryKeyColumns.value = []
    primaryKeyLookupKey.value = ''
    return
  }

  const lookupKey = `${profile.id}:${tableTab.value.schemaName}:${tableTab.value.tableName}`

  if (lookupKey === primaryKeyLookupKey.value) {
    return
  }

  const engine = getQueryEngine()
  const pkResult = await engine.execute({
    connectionId: profile.id,
    sql: getPrimaryKeyMetadataSql(profile),
  })

  primaryKeyColumns.value = parsePrimaryKeyColumns(profile, pkResult)
  primaryKeyLookupKey.value = lookupKey
}

function extractTotalRows(countResult: QueryResult): number | null {
  const firstRow = countResult.rows[0]

  if (!firstRow) {
    return null
  }

  const firstValue = Object.values(firstRow)[0]
  const total = Number(firstValue)

  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null
}

function resetPendingEdits(): void {
  pendingEditsByKey.value = {}
}

function resetPendingChanges(): void {
  pendingInsertedRows.value = []
  pendingDeletedRowsByKey.value = {}
  selectedRowIds.value = []
  activeRowId.value = ''
  resetPendingEdits()
}

function resetTableRuntimeState(): void {
  paginationPage.value = 1
  hasNextPage.value = false
  totalRows.value = null
  primaryKeyColumns.value = []
  primaryKeyLookupKey.value = ''
  resetPendingChanges()
}

async function loadTableRows(page = 1): Promise<void> {
  errorMessage.value = ''

  if (!tableTab.value) {
    result.value = null

    if (!workbenchStore.hasHydrated) {
      return
    }

    errorMessage.value = 'Object tab not found. Reopen it from the schema tree.'
    return
  }

  const profile = connectionProfile.value

  if (!profile) {
    result.value = null

    if (!connectionsStore.hasHydrated) {
      return
    }

    errorMessage.value =
      'Connection profile was removed. Reopen this object from an active connection.'
    return
  }

  isLoading.value = true

  try {
    const engine = getQueryEngine()
    const connectResult = await engine.connect(profile)
    applyResolvedDesktopTlsMode(profile, connectResult)
    try {
      await loadPrimaryKeyColumns(profile)
    } catch {
      primaryKeyColumns.value = []
      primaryKeyLookupKey.value = ''
    }

    const pageSize = resolvedPageSize.value
    const paginatedSql = buildPaginatedSql({
      dialect: profile.target.dialect,
      sql: buildBaseSelectSql(profile),
      page,
      pageSize,
      fetchExtraRow: true,
    })
    const nextResult = await engine.execute({
      connectionId: profile.id,
      sql: paginatedSql,
    })
    const pageHasNext = nextResult.rows.length > pageSize
    const rows = pageHasNext ? nextResult.rows.slice(0, pageSize) : nextResult.rows

    result.value = {
      ...nextResult,
      rows,
      rowCount: rows.length,
    }
    selectedRowIds.value = []
    activeRowId.value = ''
    paginationPage.value = page
    hasNextPage.value = pageHasNext

    try {
      const countResult = await engine.execute({
        connectionId: profile.id,
        sql: buildCountSql(profile),
      })
      totalRows.value = extractTotalRows(countResult)
    } catch {
      totalRows.value = null
    }
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope)
    }

    errorMessage.value =
      error instanceof Error ? error.message : 'Unable to load rows for this object.'
  } finally {
    isLoading.value = false
  }
}

function applyFilters(): void {
  if (isReadOnlyView.value) {
    return
  }

  void loadTableRows(1)
}

function resetFilters(): void {
  if (isReadOnlyView.value) {
    return
  }

  filters.whereClause = ''
  filters.orderBy = ''
  void loadTableRows(1)
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    try {
      return JSON.stringify(left) === JSON.stringify(right)
    } catch {
      return false
    }
  }

  return false
}

function toRowKey(primaryKeyValues: Record<string, unknown>): string {
  return primaryKeyColumns.value
    .map((column) => `${column}:${JSON.stringify(primaryKeyValues[column])}`)
    .join('|')
}

function getPrimaryKeySnapshot(rowData: Record<string, unknown>): {
  rowKey: string
  primaryKeyValues: Record<string, unknown>
} | null {
  if (!hasPrimaryKey.value) {
    return null
  }

  const primaryKeyValues: Record<string, unknown> = {}

  for (const primaryKeyColumn of primaryKeyColumns.value) {
    if (!(primaryKeyColumn in rowData)) {
      return null
    }

    primaryKeyValues[primaryKeyColumn] = rowData[primaryKeyColumn]
  }

  return {
    rowKey: toRowKey(primaryKeyValues),
    primaryKeyValues,
  }
}

function isInsertedGridRow(rowData: Record<string, unknown>): rowData is TableGridRow {
  return rowData.__qwerioRowKind === 'insert'
}

function isExistingGridRow(rowData: Record<string, unknown>): rowData is TableGridRow {
  return rowData.__qwerioRowKind === 'existing'
}

function toDraftRowId(draftId: string): string {
  return `insert:${draftId}`
}

function createDraftValues(seed: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    (result.value?.columns ?? []).map((column) => [column.name, seed[column.name]])
  )
}

function createPendingInsertedRow(seed: Record<string, unknown> = {}): PendingInsertedRow {
  return {
    id: createNanoId(),
    values: createDraftValues(seed),
  }
}

function toExistingGridRow(rowData: Record<string, unknown>, rowIndex: number): TableGridRow {
  const rowSnapshot = getPrimaryKeySnapshot(rowData)

  return {
    ...rowData,
    __qwerioRowId: rowSnapshot
      ? `existing:${rowSnapshot.rowKey}`
      : `existing:${paginationPage.value}:${rowIndex}`,
    __qwerioRowKind: 'existing',
    ...(rowSnapshot ? { __qwerioRowKey: rowSnapshot.rowKey } : {}),
  }
}

function toInsertedGridRow(draftRow: PendingInsertedRow): TableGridRow {
  return {
    ...createDraftValues(draftRow.values),
    __qwerioRowId: toDraftRowId(draftRow.id),
    __qwerioRowKind: 'insert',
    __qwerioDraftId: draftRow.id,
  }
}

const displayResult = computed<QueryResult | null>(() => {
  if (!result.value) {
    return null
  }

  const insertedRows = pendingInsertedRows.value.map((draftRow) => toInsertedGridRow(draftRow))
  const existingRows = result.value.rows
    .map((row, rowIndex) => toExistingGridRow(row, rowIndex))
    .filter((row) => !row.__qwerioRowKey || !(row.__qwerioRowKey in pendingDeletedRowsByKey.value))

  return {
    ...result.value,
    rows: [...insertedRows, ...existingRows],
  }
})

const selectedDisplayRows = computed(() => {
  const selectedIds = new Set(selectedRowIds.value)
  return (displayResult.value?.rows ?? []).filter((row): row is TableGridRow => {
    return (
      typeof row.__qwerioRowId === 'string' &&
      typeof row.__qwerioRowKind === 'string' &&
      selectedIds.has(row.__qwerioRowId)
    )
  })
})
const activeDisplayRow = computed(() => {
  if (!activeRowId.value) {
    return null
  }

  return (
    (displayResult.value?.rows ?? []).find(
      (row): row is TableGridRow => row.__qwerioRowId === activeRowId.value
    ) ?? null
  )
})
const duplicateSourceRows = computed(() =>
  selectedDisplayRows.value.length > 0
    ? selectedDisplayRows.value
    : activeDisplayRow.value
      ? [activeDisplayRow.value]
      : []
)

const selectedRowCount = computed(() => selectedDisplayRows.value.length)
const selectionStatusLabel = computed(() =>
  selectedRowCount.value > 0
    ? `${selectedRowCount.value} selected`
    : activeDisplayRow.value
      ? 'Cell row active'
      : 'No rows selected'
)
const canDuplicateSelectedRows = computed(
  () => !isReadOnlyView.value && duplicateSourceRows.value.length > 0
)
const canDeleteSelectedRows = computed(
  () =>
    !isReadOnlyView.value &&
    selectedDisplayRows.value.some(
      (row) =>
        isInsertedGridRow(row) ||
        (isExistingGridRow(row) && hasPrimaryKey.value && getPrimaryKeySnapshot(row) !== null)
    )
)

function resolveGridCellEditable(rowData: Record<string, unknown>, column: string): boolean {
  if (isReadOnlyView.value) {
    return false
  }

  if (isInsertedGridRow(rowData)) {
    return true
  }

  return canInlineEdit.value && !primaryKeyColumns.value.includes(column)
}

function resolveGridRowClass(rowData: Record<string, unknown>): string | undefined {
  return isInsertedGridRow(rowData) ? 'qwerio-row-insert' : undefined
}

function updatePendingInsertedRowValue(draftId: string, column: string, value: unknown): void {
  pendingInsertedRows.value = pendingInsertedRows.value.map((draftRow) =>
    draftRow.id === draftId
      ? {
          ...draftRow,
          values: {
            ...draftRow.values,
            [column]: value,
          },
        }
      : draftRow
  )
}

function removePendingEditsForRow(rowKey: string): void {
  pendingEditsByKey.value = Object.fromEntries(
    Object.entries(pendingEditsByKey.value).filter(([, edit]) => edit.rowKey !== rowKey)
  )
}

function addEmptyRow(): void {
  if (isReadOnlyView.value || !result.value) {
    return
  }

  pendingInsertedRows.value = [createPendingInsertedRow(), ...pendingInsertedRows.value]
}

function duplicateSelectedRows(): void {
  if (!canDuplicateSelectedRows.value || !result.value) {
    return
  }

  const duplicatedRows = duplicateSourceRows.value.map((row) => {
    const duplicatedValues = createDraftValues(row)

    if (hasPrimaryKey.value) {
      primaryKeyColumns.value.forEach((primaryKeyColumn) => {
        duplicatedValues[primaryKeyColumn] = undefined
      })
    }

    return createPendingInsertedRow(duplicatedValues)
  })

  pendingInsertedRows.value = [...duplicatedRows, ...pendingInsertedRows.value]
  selectedRowIds.value = []
  activeRowId.value = ''
}

function deleteSelectedRows(): void {
  if (!canDeleteSelectedRows.value) {
    return
  }

  const nextDeletedRowsByKey = { ...pendingDeletedRowsByKey.value }
  const selectedDraftIds = new Set<string>()

  selectedDisplayRows.value.forEach((row) => {
    if (isInsertedGridRow(row) && typeof row.__qwerioDraftId === 'string') {
      selectedDraftIds.add(row.__qwerioDraftId)
      return
    }

    if (!isExistingGridRow(row)) {
      return
    }

    const rowSnapshot = getPrimaryKeySnapshot(row)

    if (!rowSnapshot) {
      return
    }

    removePendingEditsForRow(rowSnapshot.rowKey)
    nextDeletedRowsByKey[rowSnapshot.rowKey] = {
      key: rowSnapshot.rowKey,
      rowKey: rowSnapshot.rowKey,
      primaryKeyValues: rowSnapshot.primaryKeyValues,
    }
  })

  if (selectedDraftIds.size > 0) {
    pendingInsertedRows.value = pendingInsertedRows.value.filter(
      (draftRow) => !selectedDraftIds.has(draftRow.id)
    )
  }

  pendingDeletedRowsByKey.value = nextDeletedRowsByKey
  selectedRowIds.value = []
}

function handleGridCellEdited(payload: GridCellEditedPayload): void {
  if (isInsertedGridRow(payload.rowData)) {
    if (typeof payload.rowData.__qwerioDraftId !== 'string') {
      return
    }

    updatePendingInsertedRowValue(payload.rowData.__qwerioDraftId, payload.column, payload.newValue)
    return
  }

  if (!canInlineEdit.value || primaryKeyColumns.value.includes(payload.column)) {
    return
  }

  const rowSnapshot = getPrimaryKeySnapshot(payload.rowData)

  if (!rowSnapshot) {
    return
  }

  const editKey = `${rowSnapshot.rowKey}:${payload.column}`
  const existingEdit = pendingEditsByKey.value[editKey]

  if (existingEdit) {
    if (areValuesEqual(payload.newValue, existingEdit.oldValue)) {
      const { [editKey]: _, ...rest } = pendingEditsByKey.value
      pendingEditsByKey.value = rest
      return
    }

    pendingEditsByKey.value = {
      ...pendingEditsByKey.value,
      [editKey]: {
        ...existingEdit,
        newValue: payload.newValue,
      },
    }
    return
  }

  if (areValuesEqual(payload.oldValue, payload.newValue)) {
    return
  }

  pendingEditsByKey.value = {
    ...pendingEditsByKey.value,
    [editKey]: {
      key: editKey,
      rowKey: rowSnapshot.rowKey,
      column: payload.column,
      oldValue: payload.oldValue,
      newValue: payload.newValue,
      primaryKeyValues: rowSnapshot.primaryKeyValues,
    },
  }
}

async function confirmPendingChanges(): Promise<void> {
  if (totalPendingChangeCount.value === 0) {
    return
  }

  const profile = connectionProfile.value

  if (!profile || !tableTab.value) {
    return
  }

  isSavingChanges.value = true
  errorMessage.value = ''

  try {
    const groupedByRow = new Map<
      string,
      {
        primaryKeyValues: Record<string, unknown>
        updates: PendingCellEdit[]
      }
    >()

    pendingEdits.value.forEach((edit) => {
      const existing = groupedByRow.get(edit.rowKey)

      if (existing) {
        existing.updates = existing.updates
          .filter((item) => item.column !== edit.column)
          .concat(edit)
        return
      }

      groupedByRow.set(edit.rowKey, {
        primaryKeyValues: edit.primaryKeyValues,
        updates: [edit],
      })
    })

    const engine = getQueryEngine()
    const connectResult = await engine.connect(profile)
    applyResolvedDesktopTlsMode(profile, connectResult)
    const fromClause = buildFromClause(profile)

    for (const deletedRow of Object.values(pendingDeletedRowsByKey.value)) {
      await engine.execute({
        connectionId: profile.id,
        sql: `delete from ${fromClause} where ${buildPrimaryKeyWhereSql(
          profile,
          deletedRow.primaryKeyValues
        )}`,
      })
    }

    for (const rowUpdate of groupedByRow.values()) {
      const setSql = rowUpdate.updates
        .map(
          (update) =>
            `${quoteIdentifier(profile.target.dialect, update.column)} = ${toSqlLiteral(profile.target.dialect, update.newValue)}`
        )
        .join(', ')

      await engine.execute({
        connectionId: profile.id,
        sql: `update ${fromClause} set ${setSql} where ${buildPrimaryKeyWhereSql(
          profile,
          rowUpdate.primaryKeyValues
        )}`,
      })
    }

    for (const draftRow of pendingInsertedRows.value) {
      await engine.execute({
        connectionId: profile.id,
        sql: buildInsertSql(profile, draftRow.values),
      })
    }

    resetPendingChanges()
    await loadTableRows(paginationPage.value)
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope)
    }

    errorMessage.value =
      error instanceof Error ? error.message : 'Unable to apply pending row changes.'
  } finally {
    isSavingChanges.value = false
  }
}

function rollbackPendingChanges(): void {
  resetPendingChanges()
  void loadTableRows(paginationPage.value)
}

function handleGridSelectionChanged(rowIds: string[]): void {
  selectedRowIds.value = rowIds
}

function handleActiveRowChanged(rowId: string): void {
  activeRowId.value = rowId
}

function handlePaginationChange(page: number): void {
  void loadTableRows(page)
}

watch(
  () => tableTabId.value,
  () => {
    filters.whereClause = ''
    filters.orderBy = ''
    resetTableRuntimeState()
    void loadTableRows(1)
  },
  { immediate: true }
)

watch(
  () => appSettingsStore.resultsPageSize,
  () => {
    void loadTableRows(1)
  }
)

watch(
  () => workbenchStore.hasHydrated,
  (hydrated) => {
    if (hydrated && tableTabId.value) {
      void loadTableRows(1)
    }
  }
)

watch(
  () => connectionsStore.hasHydrated,
  (hydrated) => {
    if (hydrated && tableTabId.value) {
      void loadTableRows(1)
    }
  }
)

watch(
  () => vaultStore.needsUnlockPrompt,
  (needsUnlockPrompt, previousNeedsUnlockPrompt) => {
    if (previousNeedsUnlockPrompt && !needsUnlockPrompt) {
      void loadTableRows(paginationPage.value)
    }
  }
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col gap-2">
    <section class="panel-tight p-3">
      <div
        class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--chrome-border)] pb-3"
      >
        <div>
          <h2 class="font-display text-lg font-semibold tracking-[0.04em] text-[var(--chrome-ink)]">
            {{ tableTitle }}
          </h2>
          <p
            class="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--chrome-ink-muted)]"
          >
            {{ objectLabel }}
            <span v-if="isReadOnlyView"> · read-only</span>
            <span> · {{ resolvedPageSize }} rows/page</span>
          </p>
        </div>

        <div class="inline-flex items-center gap-2">
          <span class="chrome-pill" v-if="isLoading || isSavingChanges">
            {{ isSavingChanges ? 'Saving...' : 'Loading...' }}
          </span>
          <button
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="loadTableRows(paginationPage)"
          >
            <RefreshCcw :size="13" />
            Refresh
          </button>
        </div>
      </div>

      <div
        v-if="!isReadOnlyView"
        class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <label class="chrome-label">
          <span>Where</span>
          <input
            v-model="filters.whereClause"
            class="chrome-input chrome-input-sm mt-1"
            type="text"
            placeholder="id > 100"
          />
        </label>

        <label class="chrome-label">
          <span>Order</span>
          <input
            v-model="filters.orderBy"
            class="chrome-input chrome-input-sm mt-1"
            type="text"
            placeholder="created_at desc"
          />
        </label>

        <div class="flex items-center gap-2 md:pt-5">
          <button
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="applyFilters"
          >
            <Filter :size="12" />
            Apply
          </button>

          <button
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="resetFilters"
          >
            <RotateCcw :size="12" />
            Reset
          </button>
        </div>
      </div>

      <div
        v-if="!isReadOnlyView && !hasPrimaryKey"
        class="mt-3 border border-[var(--chrome-border)] bg-[var(--chrome-surface-muted)] px-2.5 py-2 text-xs text-[var(--chrome-ink-dim)]"
      >
        Existing-row updates and deletes are disabled. This table needs a primary key for atomic
        mutations, but you can still stage new inserts.
      </div>
    </section>

    <div class="min-h-0 flex-1 overflow-hidden">
      <ResultsGrid
        :result="displayResult"
        :error-message="errorMessage"
        :pagination="gridPagination"
        :editable="canEditGrid"
        :non-editable-columns="primaryKeyColumns"
        row-selection="multiple"
        :selected-row-ids="selectedRowIds"
        row-id-field="__qwerioRowId"
        :is-cell-editable="resolveGridCellEditable"
        :row-class-resolver="resolveGridRowClass"
        @change-page="handlePaginationChange"
        @cell-edited="handleGridCellEdited"
        @active-row-changed="handleActiveRowChanged"
        @selection-changed="handleGridSelectionChanged"
      >
        <template #footer-center>
          <div
            v-if="!isReadOnlyView && displayResult"
            class="flex flex-wrap items-center justify-center gap-3 px-2 py-1"
          >
            <p class="text-xs text-[var(--chrome-ink-dim)]">
              {{ selectionStatusLabel }} · {{ pendingChangesStatusLabel }}
            </p>
            <div class="inline-flex items-center gap-1.5">
              <button
                type="button"
                class="chrome-btn inline-flex size-7 items-center justify-center !px-0 !py-0"
                :disabled="isLoading || isSavingChanges"
                aria-label="Add row"
                title="Add row"
                @click="addEmptyRow"
              >
                <Plus :size="12" />
              </button>
              <button
                type="button"
                class="chrome-btn inline-flex size-7 items-center justify-center !px-0 !py-0"
                :disabled="isLoading || isSavingChanges || !canDuplicateSelectedRows"
                aria-label="Duplicate row"
                title="Duplicate row"
                @click="duplicateSelectedRows"
              >
                <Copy :size="12" />
              </button>
              <button
                type="button"
                class="chrome-btn chrome-btn-danger inline-flex size-7 items-center justify-center !px-0 !py-0"
                :disabled="isLoading || isSavingChanges || !canDeleteSelectedRows"
                aria-label="Delete selected rows"
                title="Delete selected rows"
                @click="deleteSelectedRows"
              >
                <Trash2 :size="12" />
              </button>
            </div>
            <div class="h-4 w-px bg-[var(--chrome-border)]" />
            <div class="inline-flex items-center gap-2">
              <button
                type="button"
                class="chrome-btn inline-flex h-7 items-center gap-1 !py-0.5"
                :disabled="isSavingChanges || !hasPendingChanges"
                @click="rollbackPendingChanges"
              >
                <RotateCcw :size="12" />
                Rollback
              </button>
              <button
                type="button"
                class="chrome-btn chrome-btn-primary inline-flex h-7 items-center gap-1 !py-0.5"
                :disabled="isSavingChanges || !hasPendingChanges"
                @click="confirmPendingChanges"
              >
                <Check :size="12" />
                Confirm
              </button>
            </div>
          </div>
        </template>
      </ResultsGrid>
    </div>
  </div>
</template>
