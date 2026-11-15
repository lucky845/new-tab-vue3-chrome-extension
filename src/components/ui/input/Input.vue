<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/src/lib/utils';

const props = defineProps<{ modelValue?: string; class?: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const classes = computed(() =>
  cn(
    'h-9 w-full rounded-lg bg-white/10 px-3 text-sm text-white placeholder:text-white/50',
    'ring-1 ring-inset ring-white/20 outline-none transition',
    'focus:bg-white/16 focus:ring-white/40',
    props.class
  )
);
</script>

<template>
    <input
        :class="classes"
        :value="modelValue"
        :placeholder="placeholder"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
</template>
