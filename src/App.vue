<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import ClockBlock from '@/src/components/ClockBlock.vue';
import SearchBlock from '@/src/components/SearchBlock.vue';
import QuickAccessGrid from '@/src/components/QuickAccessGrid.vue';
import TodoPanel from '@/src/components/TodoPanel.vue';
import NotesPanel from '@/src/components/NotesPanel.vue';
import PomodoroPanel from '@/src/components/PomodoroPanel.vue';
import PomodoroCard from '@/src/components/PomodoroCard.vue';
import WallpaperPanel from '@/src/components/WallpaperPanel.vue';
import WeatherCard from '@/src/components/WeatherCard.vue';
import WeatherPanel from '@/src/components/WeatherPanel.vue';
import ToolsPanel from '@/src/components/ToolsPanel.vue';
import SettingsPanel from '@/src/components/SettingsPanel.vue';
import TodoCard from '@/src/components/TodoCard.vue';
import NotesCard from '@/src/components/NotesCard.vue';
import ToolsCard from '@/src/components/ToolsCard.vue';
import QuickAccessDialog from '@/src/components/QuickAccessDialog.vue';
import FolderOverlay from '@/src/components/FolderOverlay.vue';
import { setPanelOriginFromEvent, usePanels, type PanelId } from '@/src/composables/usePanels';
import { useWallpaper } from '@/src/composables/useWallpaper';
import { useTheme } from '@/src/composables/useTheme';
import { useMotion } from '@/src/composables/useMotion';
import { bindWingsAttribute } from '@/src/composables/useSideCards';
import ToastHost from '@/src/components/common/ToastHost.vue';
import TipHost from '@/src/components/common/TipHost.vue';

/**
 * 首屏外壳 + 已迁移面板挂载点。
 *
 * <main>（时钟/搜索/快捷访问）与本轮迁移的六个面板（待办/便签/番茄钟/壁纸/
 * 天气设置/小工具）+ 天气侧卡 + 番茄钟迷你卡全部由 Vue 渲染；设置面板、
 * 快捷访问弹窗/文件夹浮层也已迁移为 Vue3 组件，Teleport 到 body 保持层级。
 * 面板 Teleport 进 #legacy-panels-root：与旧面板同一 DOM 层级，
 * 玻璃挂载（glass-panels 的 .side-card/.weather-widget 目标）与样式选择器不变。
 */
const props = defineProps<{ dataReady?: boolean }>();

const ready = computed(() => props.dataReady !== false);
const panels = usePanels();
const wallpaper = useWallpaper();

/**
 * 首屏控制按钮 → 面板开合接线。这些按钮仍是 newtab.html 里的静态 HTML 节点，
 * 故在 onMounted 里按 id 绑定；开合语义沿用 legacy 的 toggle。
 * 侧卡与弹窗内部的交互已由各 Vue3 组件自持（@click / v-model），无需在此代理。
 */
const BUTTON_WIRING: Array<[string, PanelId]> = [
  ['todo-btn', 'todo'],
  ['notes-btn', 'notes'],
  ['pomodoro-btn', 'pomodoro'],
  ['wallpaper-settings-btn', 'wallpaper'],
  // 注意：天气设置入口 #weather-settings-btn 在 WeatherCard 内部，由该组件自己的
  // @click.stop 处理；这里再绑一次会在同一元素上双触发（open 后立刻 toggle 关掉）。
  ['settings-btn', 'settings'],
];
let unwire: (() => void) | null = null;

onMounted(() => {
  // 主题状态机（useTheme 单例幂等 init）：head 的 theme-preboot 只做首屏防白闪，
  // 这里用 chrome.storage 真值校正 + 60s 复查 + 跟随系统。
  void useTheme().init();

  // 动效降级：preboot 用 localStorage 镜像抢首帧，这里用 settings 真值校正
  void useMotion().init();

  // 启动壁纸：blob 命中零请求 → URL 校验 → 随机链
  // （legacy wallpaper-manager 的启动路径由 Vue 域接管）
  void wallpaper.fetchAndSetWallpaper();

  // 左右翼显隐 → <body data-wings>：四张侧卡都是 fixed 常驻占位，
  // 全隐时 CSS 靠这个属性把让出去的宽度还回中间内容。
  bindWingsAttribute();

  const disposers: Array<() => void> = [];

  // 控制按钮 → 面板开合
  for (const [btnId, panelId] of BUTTON_WIRING) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    const handler = (ev: Event) => {
      // 先记原点再开合：面板卡片从这颗按钮的位置长出来（app.css 的 --panel-origin）
      setPanelOriginFromEvent(panelId, ev);
      panels.toggle(panelId);
    };
    btn.addEventListener('click', handler);
    disposers.push(() => btn.removeEventListener('click', handler));
  }
  unwire = () => disposers.forEach((fn) => fn());
});

onUnmounted(() => {
  unwire?.();
});
</script>

<template>
    <main class="main-container" :data-ready="ready">
        <ClockBlock />

        <div class="content-wrapper">
            <SearchBlock />
            <QuickAccessGrid />
        </div>
    </main>

    <Teleport to="#legacy-panels-root">
        <TodoPanel />
        <NotesPanel />
        <PomodoroPanel />
        <WallpaperPanel />
        <WeatherPanel />
        <ToolsPanel />
        <SettingsPanel />
    </Teleport>
    <Teleport to="#weather-card-slot"><WeatherCard /></Teleport>
    <Teleport to="#pomodoro-card-slot"><PomodoroCard /></Teleport>
    <Teleport to="#todo-card-slot"><TodoCard /></Teleport>
    <Teleport to="#notes-card-slot"><NotesCard /></Teleport>
    <Teleport to="#tools-card-slot"><ToolsCard /></Teleport>
    <Teleport to="body">
        <QuickAccessDialog />
        <FolderOverlay />
    </Teleport>
    <ToastHost />
    <TipHost />
</template>
