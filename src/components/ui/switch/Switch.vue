<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';

/** shadcn-vue Switch（受控） */
defineProps<{ modelValue: boolean; id?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
    <SwitchRoot
        :id="id"
        :model-value="modelValue"
        class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full ring-1 ring-inset ring-white/25 transition-colors data-[state=checked]:bg-white/85 data-[state=unchecked]:bg-white/15"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <SwitchThumb
            class="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-neutral-900"
        />
    </SwitchRoot>
</template>
