<script setup lang="ts">
/**
 * 主页左翼番茄钟迷你卡 —— markup 逐字来自 entrypoints/newtab.html:349-371（#side-card-pomodoro）。
 *
 * legacy 映射（app.js）：
 * - renderPomodoroCard（1325-1350）：time/state/today 文本 + ring 进度 → 响应式绑定
 * - bindSideWidgets 番茄钟段（1388+）：开始/暂停/继续 + 跳过 → @click
 * - pomodoro-card-expand → pomodoroBtn.click()（1377）→ panels.toggle('pomodoro')
 *
 * 计时状态来自 usePomodoro 模块级单例（与 PomodoroPanel 共享；面板关了计时继续）。
 * ring 进度：legacy CIRC = 2π*34，strokeDashoffset = CIRC*(1-progress)；休息态加 .break。
 */
import { computed } from 'vue';
import { setPanelOriginFromEvent, usePanels } from '@/src/composables/usePanels';
import { usePomodoro, formatPomodoroTime } from '@/src/composables/usePomodoro';

const { toggle } = usePanels();

/** 记录展开原点后开合：面板卡片从被点的这颗按钮长出来（见 app.css 的 --panel-origin）。 */
function openPanel(id: Parameters<typeof toggle>[0], ev: MouseEvent): void {
  setPanelOriginFromEvent(id, ev);
  toggle(id);
}
const { progress, stateLabel, startLabel, stats, toggleStart, skipPhase } = usePomodoro();

// legacy renderPomodoroCard 的环形进度（CIRC = 2π*34）
const RING_CIRC = 2 * Math.PI * 34;
const dashOffset = computed(() => String(RING_CIRC * (1 - progress.value.progress)));
const timeText = computed(() => formatPomodoroTime(progress.value.remaining));
const isBreak = computed(() => progress.value.phaseType !== 'work');
const todayText = computed(() => '今日 🍅 × ' + (stats.value.completedToday || 0));
</script>

<!-- prettier-ignore -->
<template>
    <section class="side-card" id="side-card-pomodoro">
        <header class="side-card-header">
            <h3>番茄钟</h3>
            <button id="pomodoro-card-expand" class="side-expand-btn" title="打开完整面板" @click="openPanel('pomodoro', $event)">⤢</button>
        </header>
        <div class="pomodoro-mini">
            <div class="pomodoro-mini-ring">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                    <circle class="pomodoro-mini-track" cx="40" cy="40" r="34"></circle>
                    <circle
                        id="pomodoro-card-ring"
                        class="pomodoro-mini-bar"
                        :class="{ break: isBreak }"
                        cx="40"
                        cy="40"
                        r="34"
                        :style="{ strokeDasharray: String(RING_CIRC), strokeDashoffset: dashOffset }"
                    ></circle>
                </svg>
                <span id="pomodoro-card-time" class="pomodoro-mini-time">{{ timeText }}</span>
            </div>
            <div class="pomodoro-mini-info">
                <span id="pomodoro-card-state" class="pomodoro-mini-state">{{ stateLabel }}</span>
                <span id="pomodoro-card-today" class="pomodoro-mini-today">{{ todayText }}</span>
                <div class="pomodoro-mini-actions">
                    <button id="pomodoro-card-start" class="mini-btn primary" @click="toggleStart()">{{ startLabel }}</button>
                    <button id="pomodoro-card-skip" class="mini-btn" @click="skipPhase()">跳过</button>
                </div>
            </div>
        </div>
    </section>
</template>
