<script setup lang="ts">
import { computed } from "vue";
import MonacoEditor from "@guolao/vue-monaco-editor";
import { Bot, Play, Wand2 } from "lucide-vue-next";

const props = defineProps<{
  modelValue: string;
  isRunning: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  run: [];
  format: [];
}>();

const sqlValue = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value),
});

const editorOptions = {
  fontSize: 14,
  minimap: { enabled: false },
  automaticLayout: true,
  wordWrap: "on" as const,
  tabSize: 2,
  scrollBeyondLastLine: false,
};
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-3">
    <div class="panel-tight flex items-center justify-between px-3 py-2">
      <p class="font-display text-sm font-semibold tracking-tight text-slate-900">SQL Editor</p>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400"
          @click="emit('format')"
        >
          <Wand2 :size="13" />
          Format
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400"
        >
          <Bot :size="13" />
          Explain
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800"
          :disabled="isRunning"
          @click="emit('run')"
        >
          <Play :size="13" />
          {{ isRunning ? "Running..." : "Run" }}
        </button>
      </div>
    </div>

    <div class="panel-tight min-h-0 flex-1 overflow-hidden">
      <MonacoEditor
        v-model:value="sqlValue"
        class="h-full min-h-[220px]"
        language="sql"
        theme="vs-dark"
        :options="editorOptions"
      />
    </div>
  </section>
</template>
