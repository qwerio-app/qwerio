<script setup lang="ts">
import { computed } from "vue";
import MonacoEditor from "@guolao/vue-monaco-editor";
import type { MonacoEditor as MonacoInstance } from "@guolao/vue-monaco-editor";
import { Bot, Play, Save, Wand2 } from "lucide-vue-next";

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
};
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
