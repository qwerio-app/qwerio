<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import MonacoEditor from "@guolao/vue-monaco-editor";
import type { MonacoEditor as MonacoInstance } from "@guolao/vue-monaco-editor";
import { Bot, Play, Save, Wand2 } from "lucide-vue-next";
import type {
  IDisposable,
  IPosition,
  editor as MonacoEditorApi,
} from "monaco-editor";
import { buildSqlAutocompleteSuggestions } from "../../core/sql-autocomplete";
import { useConnectionsStore } from "../../stores/connections";
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
const connectionsStore = useConnectionsStore();
const workbenchStore = useWorkbenchStore();
let completionProvider: IDisposable | null = null;

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

const monacoTheme = "qwerio-dark";

const handleBeforeMount = (monaco: MonacoInstance): void => {
  monaco.editor.defineTheme(monacoTheme, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBorder": "#161b24",
      "editorCursor.foreground": "#9ca1ad",
    },
  });

  completionProvider?.dispose();
  completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", ":", "@", "$", "{", "_"],
    provideCompletionItems(
      model: MonacoEditorApi.ITextModel,
      position: IPosition,
    ) {
      const activeConnection = connectionsStore.activeProfile;
      const activeTab = workbenchStore.activeTab;
      const hasActiveScope =
        Boolean(activeConnection?.id) &&
        Boolean(activeTab?.connectionId) &&
        activeConnection?.id === activeTab?.connectionId;
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
        schemaObjectMap: hasActiveScope ? workbenchStore.schemaObjectMap : {},
        sql: model.getValue(),
        linePrefix,
        wordUntilCursor: wordUntil.word,
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
        SQL Editor
      </p>

      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="chrome-btn inline-flex items-center gap-1"
          :disabled="isSaving || !canSave"
          @click="emit('save')"
        >
          <Save :size="12" />
          {{ isSaving ? "Saving" : "Save" }}
        </button>

        <button
          type="button"
          class="chrome-btn inline-flex items-center gap-1"
          @click="emit('format')"
        >
          <Wand2 :size="12" />
          Format
        </button>

        <button
          type="button"
          class="chrome-btn inline-flex items-center gap-1"
          disabled
        >
          <Bot :size="12" />
          Explain
        </button>

        <button
          type="button"
          class="chrome-btn chrome-btn-primary inline-flex items-center gap-1"
          :disabled="isRunning"
          @click="emit('run')"
        >
          <Play :size="12" />
          {{ isRunning ? "Running" : "Run" }}
        </button>
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
      />
    </div>
  </section>
</template>
