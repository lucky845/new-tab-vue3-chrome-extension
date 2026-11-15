<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';

/** shadcn-vue Tooltip：玻璃底 + 小箭头，与页面其他浮层保持同一材质 */
defineProps<{ text: string; side?: 'top' | 'bottom' | 'left' | 'right' }>();
</script>

<template>
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <slot />
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent
                    :side="side ?? 'bottom'"
                    :side-offset="6"
                    class="z-50 rounded-lg border border-white/15 bg-black/55 px-2.5 py-1.5 text-xs text-white backdrop-blur-md select-none"
                >
                    {{ text }}
                    <TooltipArrow class="fill-black/55" :width="8" :height="4" />
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
