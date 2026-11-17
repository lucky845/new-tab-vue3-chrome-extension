<script setup lang="ts">
/**
 * 主页左翼番茄钟迷你卡 —— markup 逐字来自 entrypoints/newtab.html:349-371（#side-card-pomodoro）。
 *
 * legacy 映射（v1.8.1:js/app.js）：
 * - renderPomodoroCard（1325-1350）：time/state/today 文本 + ring 进度 → 响应式绑定
 * - bindSideWidgets 番茄钟段（1388+）：开始/暂停/继续 + 跳过 → @click
 * - 展开按钮：外壳 SideCard 记录 panelOrigin 后 toggle('pomodoro')
 *
 * 计时状态来自 usePomodoro 模块级单例（与 PomodoroPanel 共享；面板关了计时继续）。
 * ring 进度：legacy CIRC = 2π*34，strokeDashoffset = CIRC*(1-progress)；休息态加 .break。
 * 显隐 / 展开按钮 / 头部由 SideCard 外壳统一承载，本组件只管卡片主体。
 */
import { computed } from 'vue';
import SideCard from '@/src/components/common/SideCard.vue';
import { usePomodoro, formatPomodoroTime } from '@/src/composables/usePomodoro';

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
    <SideCard cardId="pomodoro" elementId="side-card-pomodoro" title="番茄钟" expandId="pomodoro-card-expand">
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
    </SideCard>
</template>
