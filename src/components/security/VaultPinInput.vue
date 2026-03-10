<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const PIN_LENGTH = 5;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    autofocus?: boolean;
    label?: string;
  }>(),
  {
    disabled: false,
    autofocus: false,
    label: "Vault PIN",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
}>();

const digitValues = ref<string[]>(Array(PIN_LENGTH).fill(""));
const inputRefs = ref<Array<HTMLInputElement | null>>(
  Array(PIN_LENGTH).fill(null),
);

function sanitizeToPin(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

function syncFromModel(value: string): void {
  const sanitized = sanitizeToPin(value);
  const digits = Array(PIN_LENGTH).fill("");

  sanitized.split("").forEach((digit, index) => {
    digits[index] = digit;
  });

  digitValues.value = digits;
}

watch(
  () => props.modelValue,
  (value) => {
    const sanitized = sanitizeToPin(value);

    if (sanitized !== value) {
      emit("update:modelValue", sanitized);
      return;
    }

    syncFromModel(sanitized);
  },
  { immediate: true },
);

function emitPin(): void {
  emit("update:modelValue", digitValues.value.join(""));
}

function focusIndex(index: number): void {
  const nextIndex = Math.max(0, Math.min(PIN_LENGTH - 1, index));
  const input = inputRefs.value[nextIndex];
  input?.focus();
  input?.select();
}

function setDigit(index: number, digit: string): void {
  digitValues.value[index] = digit;
  emitPin();
}

function applyDigits(startIndex: number, digits: string): void {
  if (!digits) {
    return;
  }

  let cursor = startIndex;

  for (const digit of digits) {
    if (cursor >= PIN_LENGTH) {
      break;
    }

    digitValues.value[cursor] = digit;
    cursor += 1;
  }

  emitPin();
  focusIndex(cursor >= PIN_LENGTH ? PIN_LENGTH - 1 : cursor);
}

function handleKeydown(event: KeyboardEvent, index: number): void {
  if (props.disabled) {
    return;
  }

  const { key } = event;

  if (/^\d$/.test(key)) {
    event.preventDefault();
    setDigit(index, key);
    focusIndex(index + 1);
    return;
  }

  if (key === "Backspace") {
    event.preventDefault();

    if (digitValues.value[index]) {
      setDigit(index, "");
      return;
    }

    if (index > 0) {
      setDigit(index - 1, "");
      focusIndex(index - 1);
    }

    return;
  }

  if (key === "Delete") {
    event.preventDefault();
    setDigit(index, "");
    return;
  }

  if (key === "ArrowLeft") {
    event.preventDefault();
    focusIndex(index - 1);
    return;
  }

  if (key === "ArrowRight") {
    event.preventDefault();
    focusIndex(index + 1);
    return;
  }

  if (key === "Tab" || key === "Home" || key === "End") {
    return;
  }

  event.preventDefault();
}

function handleInput(event: Event, index: number): void {
  if (props.disabled) {
    return;
  }

  const target = event.target;

  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const digits = sanitizeToPin(target.value);

  if (!digits) {
    setDigit(index, "");
    return;
  }

  if (digits.length === 1) {
    setDigit(index, digits);
    focusIndex(index + 1);
    return;
  }

  applyDigits(index, digits);
}

function handlePaste(event: ClipboardEvent, index: number): void {
  if (props.disabled) {
    return;
  }

  event.preventDefault();
  const pasted = event.clipboardData?.getData("text") ?? "";
  const digits = sanitizeToPin(pasted);

  if (!digits) {
    return;
  }

  applyDigits(index, digits);
}

function setInputRef(element: unknown, index: number): void {
  inputRefs.value[index] = element instanceof HTMLInputElement ? element : null;
}

watch(
  () => props.autofocus,
  async (autofocus) => {
    if (!autofocus || props.disabled) {
      return;
    }

    await nextTick();
    const firstEmptyIndex = digitValues.value.findIndex((digit) => !digit);
    focusIndex(firstEmptyIndex === -1 ? 0 : firstEmptyIndex);
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex items-center gap-2" role="group" :aria-label="label">
    <input
      v-for="(_, index) in PIN_LENGTH"
      :key="index"
      :ref="(element) => setInputRef(element, index)"
      :value="digitValues[index]"
      type="password"
      inputmode="numeric"
      pattern="[0-9]*"
      maxlength="1"
      autocomplete="one-time-code"
      class="h-11 w-11 rounded-[4px] border border-[var(--chrome-border)] bg-[var(--chrome-input-bg)] text-center text-base font-semibold text-[var(--chrome-ink)] outline-none transition focus:border-[var(--chrome-red)] sm:h-12 sm:w-12 sm:text-lg"
      :disabled="disabled"
      :aria-label="`PIN digit ${index + 1}`"
      @keydown="handleKeydown($event, index)"
      @input="handleInput($event, index)"
      @paste="handlePaste($event, index)"
    />
  </div>
</template>
