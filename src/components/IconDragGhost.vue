<script setup lang="ts">
import { computed } from "vue";
import { iconDragState } from "@/src/composables/useIconDrag";
import AppIcon from "@/src/components/AppIcon.vue";

/**
 * 拖拽跟随层：只负责「跟着指针漂一个图标」，不参与任何落点判定。
 * pointer-events:none —— 否则 elementFromPoint 会一直命中自己，永远拿不到底下真正的格子。
 */
const style = computed(() => ({
  left: iconDragState.x + "px",
  top: iconDragState.y + "px",
}));
const node = computed(() => iconDragState.node);
</script>

<template>
  <Teleport to="body">
    <div v-if="iconDragState.active && node" class="icon-drag-ghost" :style="style">
      <AppIcon :name="node.name" :url="node.url" :icon="node.icon" :glass="false" />
    </div>
  </Teleport>
</template>

<style scoped>
.icon-drag-ghost {
  position: fixed;
  z-index: 3000;
  transform: translate(-50%, -50%) scale(1.06);
  pointer-events: none;
  opacity: 0.92;
  filter: drop-shadow(0 14px 22px rgb(0 0 0 / 0.28));
}
.icon-drag-ghost :deep(.icon-square) {
  width: var(--icon-square, 86px);
  height: var(--icon-square, 86px);
}
</style>
