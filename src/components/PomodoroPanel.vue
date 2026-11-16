<script setup lang="ts">
/**
 * 番茄专注钟面板（Vue3 版）——markup 逐字移植自 entrypoints/newtab.html L296-334
 * （id/class/中文文案/SVG/DOM 层级一字未动），仅做两类授权改动：
 * ① 事件绑定为 Vue 指令（@click/@change，含根元素空白点击关闭的 legacy 等价行为）；
 * ② 响应式值注入（:class/:style/v-model/插值，替代 legacy render() 的 DOM 写入）。
 * 静态文本按钮（跳过/重置）保持单行，避免 prettier 拆行后文本节点携带边缘空格。
 * 计时业务全部在 usePomodoro() 模块级单例内（面板关闭计时不停），本组件无 UI 侧
 * 定时器，故无 onUnmounted 清理需求。
 */
import { computed, ref, watch } from 'vue';
import { usePanels } from '@/src/composables/usePanels';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { usePomodoro, formatPomodoroTime, showToast } from '@/src/composables/usePomodoro';

const { isOpen, close } = usePanels();
const {
    settings,
    stats,
    remainingSeconds,
    progress,
    stateLabel,
    startLabel,
    cycleInRound,
    toggleStart,
    skipPhase,
    reset,
    setSettings,
} = usePomodoro();

// 进度环（legacy RING_RADIUS=88，dasharray=CIRC，dashoffset=CIRC*(1-progress)）
const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const ringStyle = computed(() => ({
    strokeDasharray: String(RING_CIRCUMFERENCE),
    strokeDashoffset: String(RING_CIRCUMFERENCE * (1 - progress.value.progress)),
}));

// 时长设置折叠区（legacy togglePomodoroSettings：切 u-hidden + 按钮文案两态）
const settingsOpen = ref(false);
const settingsToggleLabel = computed(() => (settingsOpen.value ? '⚙ 收起设置' : '⚙ 时长设置'));
function toggleSettings(): void {
    settingsOpen.value = !settingsOpen.value;
}

// 四个时长输入：草稿 ref + v-model.number（legacy 任一输入 change 均整体应用）
const workDraft = ref<number>(settings.value.workMinutes);
const breakDraft = ref<number>(settings.value.breakMinutes);
const longBreakDraft = ref<number>(settings.value.longBreakMinutes);
const roundsDraft = ref<number>(settings.value.roundsBeforeLongBreak);

/** settings 异步从 chrome.storage 载入；载入完成（或外部改写）时同步草稿 */
watch(
    settings,
    (next) => {
        workDraft.value = next.workMinutes;
        breakDraft.value = next.breakMinutes;
        longBreakDraft.value = next.longBreakMinutes;
        roundsDraft.value = next.roundsBeforeLongBreak;
    },
    { deep: true }
);

async function applySettings(): Promise<void> {
    const saved = await setSettings({
        workMinutes: workDraft.value,
        breakMinutes: breakDraft.value,
        longBreakMinutes: longBreakDraft.value,
        roundsBeforeLongBreak: roundsDraft.value,
    });
    // sanitizeSettings 会丢弃非法输入：把清洗后的真值回填草稿
    workDraft.value = saved.workMinutes;
    breakDraft.value = saved.breakMinutes;
    longBreakDraft.value = saved.longBreakMinutes;
    roundsDraft.value = saved.roundsBeforeLongBreak;
    showToast('番茄钟设置已保存', 'success', 1500);
}
</script>

<template>
    <GlassPanel
        panelId="pomodoro"
        :open="isOpen('pomodoro')"
        variant="widget"
        elementId="pomodoro-panel"
        @dismiss="close('pomodoro')"
      >
        <div class="widget-content">
            <div class="widget-header">
                <h2>番茄专注钟</h2>
                <button
                    id="close-pomodoro-btn"
                    class="control-btn widget-close-btn"
                    title="关闭"
                    @click="close('pomodoro')"
                >
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                    >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="pomodoro-timer-area">
                <svg class="pomodoro-ring" viewBox="0 0 200 200" aria-hidden="true">
                    <circle class="pomodoro-ring-track" cx="100" cy="100" r="88"></circle>
                    <circle
                        class="pomodoro-ring-bar"
                        id="pomodoro-ring-progress"
                        cx="100"
                        cy="100"
                        r="88"
                        :style="ringStyle"
                        :class="{ break: progress.phaseType !== 'work' }"
                    ></circle>
                </svg>
                <div class="pomodoro-timer-center">
                    <div class="pomodoro-display" id="pomodoro-display">
                        {{ formatPomodoroTime(remainingSeconds) }}
                    </div>
                    <div class="pomodoro-state" id="pomodoro-state">{{ stateLabel }}</div>
                </div>
            </div>
            <div class="pomodoro-rounds-row">
                <span class="pomodoro-rounds" id="pomodoro-rounds">
                    <span
                        v-for="i in settings.roundsBeforeLongBreak"
                        :key="i"
                        :class="
                            i <= cycleInRound ? 'pomodoro-round-dot filled' : 'pomodoro-round-dot'
                        "
                    ></span>
                </span>
                <span class="pomodoro-today-count" id="pomodoro-today-count"
                    >今日 🍅 × {{ stats.completedToday || 0 }}</span
                >
            </div>
            <!-- prettier-ignore -->
            <div class="pomodoro-actions">
                <button id="pomodoro-start-btn" class="settings-btn" @click="toggleStart">{{ startLabel }}</button>
                <button id="pomodoro-skip-btn" class="settings-btn secondary" @click="skipPhase">跳过</button>
                <button id="pomodoro-reset-btn" class="settings-btn secondary" @click="reset">重置</button>
              </div>
            <button
                id="pomodoro-settings-toggle"
                class="link-btn pomodoro-settings-toggle"
                @click="toggleSettings"
            >
                {{ settingsToggleLabel }}
            </button>
            <div
                id="pomodoro-settings-box"
                class="pomodoro-settings-box"
                :class="{ 'u-hidden': !settingsOpen }"
            >
                <label
                    >专注
                    <input
                        type="number"
                        id="pomodoro-work-input"
                        min="1"
                        max="180"
                        v-model.number="workDraft"
                        @change="applySettings"
                    />
                    分钟</label
                >
                <label
                    >短休
                    <input
                        type="number"
                        id="pomodoro-break-input"
                        min="1"
                        max="60"
                        v-model.number="breakDraft"
                        @change="applySettings"
                    />
                    分钟</label
                >
                <label
                    >长休
                    <input
                        type="number"
                        id="pomodoro-long-break-input"
                        min="1"
                        max="90"
                        v-model.number="longBreakDraft"
                        @change="applySettings"
                    />
                    分钟</label
                >
                <label
                    >长休间隔
                    <input
                        type="number"
                        id="pomodoro-rounds-input"
                        min="2"
                        max="8"
                        v-model.number="roundsDraft"
                        @change="applySettings"
                    />
                    轮</label
                >
            </div>
        </div>
    </GlassPanel>
</template>
