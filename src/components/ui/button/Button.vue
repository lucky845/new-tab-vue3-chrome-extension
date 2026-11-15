<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/src/lib/utils';

/**
 * shadcn-vue Button。
 *
 * 与官方模板的差异：玻璃底。新标签页上按钮永远浮在壁纸上，
 * 用不透明底色会变成一块「贴纸」，所以 default 档走半透明 + backdrop-blur，
 * 圆角跟随 --radius-glass。
 */
const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'ghost' | 'outline' | 'destructive';
    size?: 'sm' | 'md' | 'icon';
    as?: string;
    class?: string;
  }>(),
  { variant: 'default', size: 'md', as: 'button' }
);

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-50';

const variants = {
  default: 'bg-white/14 text-white backdrop-blur-md hover:bg-white/22 ring-1 ring-inset ring-white/25',
  ghost: 'text-white/80 hover:bg-white/12 hover:text-white',
  outline: 'ring-1 ring-inset ring-white/30 text-white hover:bg-white/10',
  destructive: 'bg-red-500/80 text-white hover:bg-red-500',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4',
  icon: 'size-9',
} as const;

const classes = computed(() => cn(base, variants[props.variant], sizes[props.size], props.class));
</script>

<template>
    <component :is="as" :class="classes">
        <slot />
    </component>
</template>
