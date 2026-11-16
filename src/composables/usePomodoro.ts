/**
 * 番茄专注钟 composable（Vue3 版）——移植自 public/legacy-js/modules/pomodoro-manager.js
 * （业务语义唯一权威）+ public/legacy-js/app.js bindPomodoroEvents 的计时侧副作用。
 *
 * 与 legacy 的对齐要点：
 * - 计时状态是【模块级单例】：面板关闭/组件卸载不停止计时（legacy 的 PomodoroManager
 *   挂在 app 实例上，面板只是它的一个渲染面）。重开面板时响应式绑定自动恢复当前进度。
 * - setInterval 业务计时器按需启动：start() 里创建，pause/reset/skip/completePhase 里
 *   清除——与 legacy 完全一致；组件的 onUnmounted 无需（也不允许）清它。
 * - 持久化键一字不差：pomodoroSettings / pomodoroStats，存裸对象（chrome.storage 结构化
 *   克隆），迁移/清洗逻辑在 useStored 的 load 选项里等价实现。
 * - legacy 行为怪癖原样保留（详见交付报告）：start() 立即 tick 一秒；进入休息阶段后
 *   不自动倒计时（需 暂停→继续 才开始走）。
 */
import { log } from '@/src/lib/log';
import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useStored } from '@/src/lib/storage';
import { toast as showToast } from '@/src/composables/useToast';
export { showToast };

// ---------- 类型 ----------

export type PomodoroState = 'idle' | 'working' | 'resting' | 'paused';
export type PomodoroPhaseType = 'work' | 'break' | 'longBreak';

export interface PomodoroSettings {
    workMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    roundsBeforeLongBreak: number;
}

/** UI 输入可能是字符串（number input 的 .value），清洗在 sanitizeSettings 内完成 */
export type PomodoroSettingsInput = { [K in keyof PomodoroSettings]?: unknown };

export interface PomodoroStats {
    date: string; // 'YYYY-MM-DD'
    cycleCount: number;
    completedToday: number;
    totalAllTime: number;
}

export interface PomodoroProgress {
    remaining: number;
    total: number;
    progress: number; // 0..1，阶段已流逝比例
    phaseType: PomodoroPhaseType;
}

export interface PomodoroCurrentState {
    state: PomodoroState;
    phaseType: PomodoroPhaseType;
    remainingSeconds: number;
    running: boolean;
    settings: PomodoroSettings;
    stats: PomodoroStats;
}

// ---------- 常量 ----------

export const POMODORO_SETTINGS_KEY = 'pomodoroSettings';
export const POMODORO_STATS_KEY = 'pomodoroStats';

const DEFAULT_SETTINGS: PomodoroSettings = {
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    roundsBeforeLongBreak: 4,
};

const DEFAULT_STATS: PomodoroStats = {
    date: '',
    cycleCount: 0,
    completedToday: 0,
    totalAllTime: 0,
};

/** 阶段完成 toast 文案（legacy app.js onPhaseComplete） */
const PHASE_MESSAGES: Record<PomodoroPhaseType, string> = {
    break: '🍅 专注完成！休息一下',
    longBreak: '🎉 完成一整轮！进入长休息',
    work: '⏰ 休息结束，开始新一轮专注',
};

// ---------- 纯函数 ----------

/** 格式化 mm:ss（legacy PomodoroManager.format） */
export function formatPomodoroTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 今日标签 YYYY-MM-DD（legacy PomodoroManager.todayLabel） */
export function todayLabel(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

/** 设置清洗：分钟 1..180 取整，轮次 2..8 取整；非法字段剔除（legacy sanitizeSettings） */
export function sanitizeSettings(raw: unknown): Partial<PomodoroSettings> {
    if (raw === null || typeof raw !== 'object') return {};
    const source = raw as Record<string, unknown>;
    const clampMinutes = (value: unknown): number | null => {
        const n = Math.round(Number(value));
        return Number.isFinite(n) ? Math.min(180, Math.max(1, n)) : null;
    };
    const out: Partial<PomodoroSettings> = {};
    const work = clampMinutes(source.workMinutes);
    if (work) out.workMinutes = work;
    const brk = clampMinutes(source.breakMinutes);
    if (brk) out.breakMinutes = brk;
    const longBrk = clampMinutes(source.longBreakMinutes);
    if (longBrk) out.longBreakMinutes = longBrk;
    const rounds = Math.round(Number(source.roundsBeforeLongBreak));
    if (Number.isFinite(rounds)) {
        out.roundsBeforeLongBreak = Math.min(8, Math.max(2, rounds));
    }
    return out;
}

/**
 * 稳定身份 loader：内容不变时返回同一对象引用。
 *
 * 必要性：useStored 的 onChanged 回声路径会对每次 get 重新 apply；若 load 每次产出新
 * 对象，deep watch 会把「回声」当成新写入再次落盘 → 无限写循环。内容等价时复用引用
 * 即可掐断（Object.is 相同的 ref 赋值不触发 watch）。
 */
function stableLoader<T>(build: (raw: unknown) => T): (raw: unknown) => T {
    let cached: T | null = null;
    return (raw: unknown): T => {
        const next = build(raw);
        if (cached !== null && JSON.stringify(cached) === JSON.stringify(next)) return cached;
        cached = next;
        return next;
    };
}

/** 设置加载/迁移：合并默认值 + 清洗（legacy init 的 savedSettings 分支） */
function buildSettings(raw: unknown): PomodoroSettings {
    return { ...DEFAULT_SETTINGS, ...sanitizeSettings(raw) };
}

/** 统计加载/迁移：合并默认值 + 跨日重置今日轮次（legacy init 的 savedStats 分支 + 重置逻辑） */
function buildStats(raw: unknown): PomodoroStats {
    const saved = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const merged = { ...DEFAULT_STATS, ...saved } as PomodoroStats;
    const today = todayLabel();
    if (merged.date !== today) {
        merged.date = today;
        merged.cycleCount = 0;
        merged.completedToday = 0;
        // legacy init() 的跨日重置是立即 saveStats 落盘的，这里等价直写一次
        void chrome.storage.local.set({ [POMODORO_STATS_KEY]: merged });
    }
    return merged;
}

// ---------- 模块级单例状态（面板关了计时继续走） ----------

const settings = useStored<PomodoroSettings>(
    POMODORO_SETTINGS_KEY,
    { ...DEFAULT_SETTINGS },
    {
        load: stableLoader(buildSettings),
    }
);

const stats = useStored<PomodoroStats>(
    POMODORO_STATS_KEY,
    // 无存量数据时以今日为初始 date，避免首记一笔被跨日重置清零（legacy init 等效状态）
    { date: todayLabel(), cycleCount: 0, completedToday: 0, totalAllTime: 0 },
    { load: stableLoader(buildStats) }
);

const state = ref<PomodoroState>('idle'); // idle | working | resting | paused
const phaseType = ref<PomodoroPhaseType>('work'); // work | break | longBreak
const remainingSeconds = ref(DEFAULT_SETTINGS.workMinutes * 60);
let pausedFrom: PomodoroState = 'working';
let timerId: ReturnType<typeof setInterval> | undefined = undefined;

// ---------- 计时侧副作用（legacy 在 bindPomodoroEvents 里绑定的 onTick/onPhaseComplete） ----------

let audioCtx: AudioContext | null = null;

/** Web Audio 完成提示音：三音上行 E5 G#5 B5，无资源文件（legacy playChime） */
function playChime(): void {
    try {
        const audioHost = globalThis as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
        };
        const Ctor = audioHost.AudioContext ?? audioHost.webkitAudioContext;
        if (!Ctor) throw new Error('AudioContext unavailable');
        audioCtx = audioCtx ?? new Ctor();
        const ctx = audioCtx;
        const notes = [659.25, 830.61, 987.77]; // E5 G#5 B5
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t0 = ctx.currentTime + i * 0.18;
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + 0.5);
        });
    } catch (error) {
        log.warn('[pomodoro] 提示音播放失败:', (error as Error)?.message ?? error);
    }
}

/** 阶段完成：声音 + toast（legacy pm.onPhaseComplete） */
function notifyComplete(nextPhase: PomodoroPhaseType): void {
    playChime();
    showToast(PHASE_MESSAGES[nextPhase], 'success', 4000);
}

// 标题联动：运行中显示「mm:ss · 状态」，否则恢复（legacy render 的 document.title 分支）
const DEFAULT_TITLE = typeof document === 'undefined' ? '' : document.title;
watch([remainingSeconds, state, phaseType, settings, stats], () => {
    if (typeof document === 'undefined') return;
    if (state.value === 'working' || state.value === 'resting') {
        document.title = `${formatPomodoroTime(remainingSeconds.value)} · ${stateLabel.value}`;
    } else if (document.title !== DEFAULT_TITLE) {
        document.title = DEFAULT_TITLE;
    }
});

// 设置加载完成/变更后，空闲态按新时长重置（legacy init 尾部 + setSettings 的 idle 分支）
watch(settings, value => {
    if (state.value === 'idle') {
        remainingSeconds.value = value.workMinutes * 60;
    }
});

// ---------- 状态机（逐方法对齐 PomodoroManager） ----------

function tick(): void {
    remainingSeconds.value -= 1;
    if (remainingSeconds.value <= 0) {
        completePhase();
        return;
    }
}

function completePhase(): void {
    clearInterval(timerId);
    timerId = undefined;
    if (phaseType.value === 'work') {
        stats.value.cycleCount = (stats.value.cycleCount || 0) + 1;
        stats.value.completedToday = (stats.value.completedToday || 0) + 1;
        stats.value.totalAllTime = (stats.value.totalAllTime || 0) + 1;
        enterBreak(true);
    } else {
        state.value = 'idle';
        phaseType.value = 'work';
        remainingSeconds.value = settings.value.workMinutes * 60;
        notifyComplete('work');
    }
}

/** 进入休息阶段（counted 表示是否为完整专注轮；legacy enterBreak） */
function enterBreak(counted: boolean): void {
    const rounds = settings.value.roundsBeforeLongBreak;
    const longDue = counted && rounds > 0 && stats.value.cycleCount % rounds === 0;
    phaseType.value = longDue ? 'longBreak' : 'break';
    state.value = 'resting';
    remainingSeconds.value =
        (longDue ? settings.value.longBreakMinutes : settings.value.breakMinutes) * 60;
    notifyComplete(longDue ? 'longBreak' : 'break');
}

/** 开始 / 继续（legacy start：立即 tick 一秒后再建 interval） */
function start(): void {
    if (state.value === 'working' || state.value === 'resting') return;
    if (state.value === 'paused') {
        state.value = pausedFrom; // 恢复到暂停前的阶段
    } else if (state.value === 'idle') {
        phaseType.value = 'work';
        state.value = 'working';
        remainingSeconds.value = settings.value.workMinutes * 60;
    }
    tick();
    timerId = setInterval(tick, 1000);
}

/** 暂停（legacy pause） */
function pause(): void {
    if (state.value !== 'working' && state.value !== 'resting') return;
    pausedFrom = state.value;
    state.value = 'paused';
    clearInterval(timerId);
    timerId = undefined;
}

/** 重置回初始专注阶段（legacy reset） */
function reset(): void {
    clearInterval(timerId);
    timerId = undefined;
    state.value = 'idle';
    phaseType.value = 'work';
    remainingSeconds.value = settings.value.workMinutes * 60;
}

/** 跳过当前阶段（不计数，直接进入下一阶段；legacy skipPhase） */
function skipPhase(): void {
    if (state.value === 'idle') return;
    clearInterval(timerId);
    timerId = undefined;
    if (phaseType.value === 'work') {
        enterBreak(false); // 跳过专注不计数，进短休
    } else {
        state.value = 'idle';
        phaseType.value = 'work';
        remainingSeconds.value = settings.value.workMinutes * 60;
        notifyComplete('work');
    }
}

/** 面板/卡片的开始按钮状态机：运行中→暂停，否则开始（legacy 两处按钮的共用逻辑） */
function toggleStart(): void {
    if (state.value === 'working' || state.value === 'resting') {
        pause();
    } else {
        start();
    }
}

/** 更新设置：空闲阶段立即生效；进行中阶段保持当前时长，下一阶段生效（legacy setSettings） */
async function setSettings(partial: PomodoroSettingsInput): Promise<PomodoroSettings> {
    const next = sanitizeSettings({ ...settings.value, ...partial });
    settings.value = { ...settings.value, ...next };
    if (state.value === 'idle') {
        phaseType.value = 'work';
        remainingSeconds.value = settings.value.workMinutes * 60;
    }
    return { ...settings.value };
}

function getSettings(): PomodoroSettings {
    return { ...settings.value };
}

function getStats(): PomodoroStats {
    return { ...stats.value };
}

/** 状态快照（legacy getCurrentState，供 UI/调试） */
function getCurrentState(): PomodoroCurrentState {
    return {
        state: state.value,
        phaseType: phaseType.value,
        remainingSeconds: remainingSeconds.value,
        running: isRunning.value,
        settings: getSettings(),
        stats: getStats(),
    };
}

// ---------- 派生状态（legacy render/getProgress/getStateLabel 的响应式版） ----------

/** 阶段总时长（秒）（legacy getPhaseTotalSeconds） */
const phaseTotalSeconds = computed<number>(() => {
    if (phaseType.value === 'break') return settings.value.breakMinutes * 60;
    if (phaseType.value === 'longBreak') return settings.value.longBreakMinutes * 60;
    return settings.value.workMinutes * 60;
});

/** 阶段进度信息（legacy getProgress） */
const progress = computed<PomodoroProgress>(() => {
    const total = phaseTotalSeconds.value;
    const value = total > 0 ? 1 - remainingSeconds.value / total : 0;
    return {
        remaining: remainingSeconds.value,
        total,
        progress: Math.min(1, Math.max(0, value)),
        phaseType: phaseType.value,
    };
});

const isRunning = computed<boolean>(() => state.value === 'working' || state.value === 'resting');

/** 阶段文案（legacy getStateLabel） */
const stateLabel = computed<string>(() => {
    switch (state.value) {
        case 'working':
            return '专注中';
        case 'resting':
            return phaseType.value === 'longBreak' ? '长休息中' : '休息中';
        case 'paused':
            return '已暂停';
        default:
            return '专注';
    }
});

/** 开始按钮文案（legacy render：运行中「暂停」/暂停「继续」/空闲「开始」） */
const startLabel = computed<string>(() =>
    isRunning.value ? '暂停' : state.value === 'paused' ? '继续' : '开始'
);

/** 当前轮内已完成专注数（legacy renderRounds 的 cycleInRound，用于圆点填充） */
const cycleInRound = computed<number>(
    () => (stats.value.cycleCount || 0) % settings.value.roundsBeforeLongBreak
);

// ---------- 对外 API ----------

export interface PomodoroApi {
    settings: Ref<PomodoroSettings>;
    stats: Ref<PomodoroStats>;
    state: Ref<PomodoroState>;
    phaseType: Ref<PomodoroPhaseType>;
    remainingSeconds: Ref<number>;
    phaseTotalSeconds: ComputedRef<number>;
    progress: ComputedRef<PomodoroProgress>;
    isRunning: ComputedRef<boolean>;
    stateLabel: ComputedRef<string>;
    startLabel: ComputedRef<string>;
    cycleInRound: ComputedRef<number>;
    start: () => void;
    pause: () => void;
    toggleStart: () => void;
    skipPhase: () => void;
    reset: () => void;
    setSettings: (partial: PomodoroSettingsInput) => Promise<PomodoroSettings>;
    getSettings: () => PomodoroSettings;
    getStats: () => PomodoroStats;
    getCurrentState: () => PomodoroCurrentState;
}

let api: PomodoroApi | null = null;

/** 模块级单例 hook：任意组件调用拿到同一份计时状态（面板与主页卡片共用） */
export function usePomodoro(): PomodoroApi {
    if (!api) {
        api = {
            settings,
            stats,
            state,
            phaseType,
            remainingSeconds,
            phaseTotalSeconds,
            progress,
            isRunning,
            stateLabel,
            startLabel,
            cycleInRound,
            start,
            pause,
            toggleStart,
            skipPhase,
            reset,
            setSettings,
            getSettings,
            getStats,
            getCurrentState,
        };
    }
    return api;
}
