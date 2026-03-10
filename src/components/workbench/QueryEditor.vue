<script setup lang="ts">
import type { MonacoEditor as MonacoInstance } from "@guolao/vue-monaco-editor";
import MonacoEditor from "@guolao/vue-monaco-editor";
import { Bot, ChevronDown, Play, Save, Wand2 } from "lucide-vue-next";
import type {
  IDisposable,
  IPosition,
  editor as MonacoEditorApi,
} from "monaco-editor";
import { computed, onBeforeUnmount, ref } from "vue";
import { buildSqlAutocompleteSuggestions } from "../../core/sql-autocomplete";
import type { SchemaObjectMap } from "../../core/query-engine";
import { filterVisibleSchemas } from "../../core/schema-visibility";
import {
  getMonacoThemeId,
  getThemeDefinition,
  themeIds,
} from "../../core/theme-registry";
import { useAppSettingsStore } from "../../stores/app-settings";
import { useConnectionsStore } from "../../stores/connections";
import { useSavedQueriesStore } from "../../stores/saved-queries";
import { useWorkbenchStore } from "../../stores/workbench";

const props = defineProps<{
  modelValue: string;
  isRunning: boolean;
  canSave?: boolean;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  run: [];
  format: [];
  save: [];
}>();
const appSettingsStore = useAppSettingsStore();
const connectionsStore = useConnectionsStore();
const savedQueriesStore = useSavedQueriesStore();
const workbenchStore = useWorkbenchStore();
let completionProvider: IDisposable | null = null;

const isRunMenuOpen = ref(false);

const sqlValue = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value),
});

const editorOptions = {
  fontSize: 13,
  fontFamily: "IBM Plex Mono",
  minimap: { enabled: false },
  automaticLayout: true,
  wordWrap: "on" as const,
  wordBasedSuggestions: "off" as const,
  suggest: {
    showKeywords: false,
    showWords: false,
  },
  tabSize: 2,
  lineNumbersMinChars: 3,
  scrollBeyondLastLine: false,
};

const monacoTheme = computed(() => getMonacoThemeId(appSettingsStore.themeId));
const editorTitle = computed(() => {
  const dialect = connectionsStore.activeProfile?.target.dialect;
  return dialect === "redis" || dialect === "mongodb"
    ? "Command Editor"
    : "SQL Editor";
});

function resolveSchemaObjectMapForAutocomplete(): Record<string, SchemaObjectMap> {
  const activeConnection = connectionsStore.activeProfile;
  const activeTab = workbenchStore.activeTab;
  const hasActiveScope =
    Boolean(activeConnection?.id) &&
    Boolean(activeTab?.connectionId) &&
    activeConnection?.id === activeTab?.connectionId;

  if (!hasActiveScope || !activeConnection) {
    return {};
  }

  const visibleSchemas = filterVisibleSchemas(
    workbenchStore.schemaNames,
    Boolean(activeConnection.showInternalSchemas),
  );

  if (visibleSchemas.length === 0) {
    return {};
  }

  const schemaLookup: Record<string, string> = {};
  visibleSchemas.forEach((schema) => {
    const schemaName = schema.name.trim();

    if (schemaName.length > 0) {
      schemaLookup[schemaName.toLowerCase()] = schemaName;
    }
  });

  const savedQuerySchemaName = activeTab?.savedQueryId
    ? savedQueriesStore.queries
        .find(
          (query) =>
            query.id === activeTab.savedQueryId &&
            query.connectionId === activeConnection.id,
        )
        ?.schemaName.trim() ?? ""
    : "";
  const resolvedSchemaFromSavedQuery =
    savedQuerySchemaName.length > 0
      ? schemaLookup[savedQuerySchemaName.toLowerCase()] ?? null
      : null;
  const resolvedSqliteSchema =
    activeConnection.target.dialect === "sqlite"
      ? schemaLookup.main ?? null
      : null;
  const resolvedPublicSchema = schemaLookup.public ?? null;
  const fallbackSchemaName = visibleSchemas[0]?.name ?? null;
  const activeSchemaName =
    resolvedSchemaFromSavedQuery ??
    resolvedSqliteSchema ??
    resolvedPublicSchema ??
    fallbackSchemaName;

  if (!activeSchemaName) {
    return {};
  }

  const activeSchemaObjectMap = workbenchStore.schemaObjectMap[activeSchemaName];

  if (!activeSchemaObjectMap) {
    return {};
  }

  return {
    [activeSchemaName]: activeSchemaObjectMap,
  };
}

function runQuery(): void {
  if (props.isRunning) {
    return;
  }

  emit("run");
}

const handleBeforeMount = (monaco: MonacoInstance): void => {
  themeIds.forEach((themeId) => {
    const themeDefinition = getThemeDefinition(themeId);

    monaco.editor.defineTheme(themeDefinition.monaco.id, {
      base: themeDefinition.monaco.base,
      inherit: true,
      rules: [],
      colors: themeDefinition.monaco.colors,
    });
  });

  completionProvider?.dispose();
  completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", ":", "@", "$", "{", "_"],
    provideCompletionItems(
      model: MonacoEditorApi.ITextModel,
      position: IPosition,
    ) {
      const wordUntil = model.getWordUntilPosition(position);
      const linePrefix = model
        .getLineContent(position.lineNumber)
        .slice(0, Math.max(position.column - 1, 0));
      const completionRange = {
        startLineNumber: position.lineNumber,
        startColumn: wordUntil.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordUntil.endColumn,
      };
      const suggestions = buildSqlAutocompleteSuggestions({
        schemaObjectMap: resolveSchemaObjectMapForAutocomplete(),
        sql: model.getValue(),
        linePrefix,
        wordUntilCursor: wordUntil.word,
        includeSchemas: false,
      }).map((suggestion) => ({
        label: suggestion.label,
        insertText: suggestion.insertText,
        detail: suggestion.detail,
        sortText: suggestion.sortText,
        range: completionRange,
        kind:
          suggestion.kind === "schema"
            ? monaco.languages.CompletionItemKind.Module
            : suggestion.kind === "tables"
              ? monaco.languages.CompletionItemKind.Struct
              : suggestion.kind === "views"
                ? monaco.languages.CompletionItemKind.Interface
                : suggestion.kind === "functions" ||
                    suggestion.kind === "procedures"
                  ? monaco.languages.CompletionItemKind.Function
                  : suggestion.kind === "triggers"
                    ? monaco.languages.CompletionItemKind.Event
                    : suggestion.kind === "indexes"
                      ? monaco.languages.CompletionItemKind.Field
                      : suggestion.kind === "sequences" ||
                          suggestion.kind === "variable"
                        ? monaco.languages.CompletionItemKind.Variable
                        : monaco.languages.CompletionItemKind.Text,
      }));

      return { suggestions };
    },
  });
};

const handleEditorMount = (
  editor: MonacoEditorApi.IStandaloneCodeEditor,
  monaco: MonacoInstance,
): void => {
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    runQuery();
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadEnter, () => {
    runQuery();
  });
};

onBeforeUnmount(() => {
  completionProvider?.dispose();
  completionProvider = null;
});
</script>

<template>
  <section class="panel-tight flex h-full min-h-0 flex-col overflow-hidden">
    <div
      class="chrome-panel-header flex items-center justify-between px-2.5 py-2"
    >
      <p
        class="font-display text-base font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
      >
        {{ editorTitle }}
      </p>

      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="chrome-btn inline-flex h-7 items-center gap-1"
          :disabled="isSaving || !canSave"
          @click="emit('save')"
        >
          <Save :size="12" />
          {{ isSaving ? "Saving" : "Save" }}
        </button>

        <div ref="runMenuRootElement" class="relative inline-flex items-center">
          <button
            type="button"
            class="chrome-btn inline-flex h-7 items-center gap-1 !rounded-r-none !border-[var(--chrome-red)] !bg-transparent !py-0 !text-[var(--chrome-ink)] hover:!bg-[var(--chrome-red-soft-hover)]"
            :disabled="isRunning"
            title="Run selection or statement at cursor (Ctrl/Cmd+Enter)"
            @click="runQuery"
          >
            <Play :size="12" />
            {{ isRunning ? "Running" : "Run" }}
          </button>

          <button
            type="button"
            class="chrome-btn inline-flex h-7 items-center !rounded-l-none !border-l-0 border-l-[var(--chrome-red)] !border-[var(--chrome-red)] !bg-transparent !px-2 !py-0 !text-[var(--chrome-ink)] hover:!bg-[var(--chrome-red-soft-hover)]"
            aria-label="Open run actions"
            aria-haspopup="menu"
            :aria-expanded="isRunMenuOpen"
            @click="isRunMenuOpen = !isRunMenuOpen"
          >
            <ChevronDown :size="12" />
          </button>

          <div
            v-if="isRunMenuOpen"
            class="panel-tight absolute right-0 top-[calc(100%+0.35rem)] z-20 min-w-40 p-1"
            role="menu"
          >
            <button
              type="button"
              class="chrome-btn inline-flex w-full items-center justify-start gap-1 text-left"
              disabled
              role="menuitem"
            >
              <Play :size="12" class="mr-1 inline-block" />
              Run Script
            </button>

            <button
              type="button"
              class="chrome-btn mt-1 inline-flex w-full items-center justify-start gap-1 text-left"
              disabled
              role="menuitem"
            >
              <Bot :size="12" class="mr-1 inline-block" />
              Explain
            </button>

            <button
              type="button"
              class="chrome-btn mt-1 inline-flex w-full items-center justify-start gap-1 text-left"
              role="menuitem"
              @click="emit('format')"
            >
              <Wand2 :size="12" class="mr-1 inline-block" />
              Format
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <MonacoEditor
        v-model:value="sqlValue"
        class="h-full min-h-[220px]"
        language="sql"
        :theme="monacoTheme"
        :options="editorOptions"
        @beforeMount="handleBeforeMount"
        @mount="handleEditorMount"
      />
    </div>
  </section>
</template>
