/**
 * 番茄专注钟 composable（Vue3 版）——移植自 v1.8.1:js/modules/pomodoro-manager.js
 * （业务语义唯一权威）+ v1.8.1:js/app.js bindPomodoroEvents 的计时侧副作用。
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
import { useStored, whenStoredHydrated } from '@/src/lib/storage';
import {
    POMODORO_RUNTIME_KEY,
    makeRuntimeRecord,
    normalizeRuntime,
    phaseSeconds,
    recoverRuntime,
    type PomodoroActiveState,
    type PomodoroPhaseType,
    type PomodoroRecoveryConfig,
    type PomodoroRuntimeRecord,
    type PomodoroState,
} from '@/src/lib/pomodoroRuntime';
import { toast as showToast } from '@/src/composables/useToast';
export { showToast };
// 状态的类型真源在 lib/pomodoroRuntime（纯函数模块），这里只做对外再导出
export type { PomodoroActiveState, PomodoroPhaseType, PomodoroState };

// ---------- 类型 ----------

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

/** 阶段完成 toast 文案（legacy v1.8.1:js/app.js:2986-2994 的 pm.onPhaseComplete 回调，文案逐字保留） */
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
let pausedFrom: PomodoroActiveState = 'working';
let timerId: ReturnType<typeof setInterval> | undefined = undefined;

// ---------- 运行态持久化（v2.2：跨标签页 / 跨重启接着走，零新权限） ----------
//
// 只写四个时机（start / pause / reset / skip / 阶段完成），**不按秒写盘**：
// 每秒写 chrome.storage 会把配额和 IO 打满，而恢复所需的信息其实只有
// 「绝对截止时间」一个数。运行中的剩余秒数由 deadline 现算（见 tick）。

/** 本上下文的身份，用来忽略自己写入触发的 onChanged 回声 */
const RUNTIME_OWNER = `pm-${Math.random().toString(36).slice(2, 10)}`;

/** 运行中阶段的绝对截止时间（毫秒）；暂停/空闲/未起表的休息阶段为 null */
let currentDeadline: number | null = null;

/** 首次水合 + 恢复完成前一律不写盘，否则默认帧会覆盖掉真实记录 */
let runtimeReady = false;
let runtimeListenerBound = false;

/**
 * 用户在恢复完成前就点了开始/暂停/重置。
 *
 * 那种情况下内存状态才是最新的，恢复逻辑必须让位——否则异步读回来的旧记录
 * 会把用户刚做的操作覆盖掉（首屏几百毫秒内点到按钮完全可能发生）。
 */
let userTouchedRuntime = false;

function writeRuntime(): void {
    if (!runtimeReady) return;
    const payload = makeRuntimeRecord({
        state: state.value,
        phaseType: phaseType.value,
        pausedFrom,
        remainingSeconds: remainingSeconds.value,
        // 用「计时器是否真的在跑」而不是 state：legacy 里休息阶段进入后 state 已是
        // resting 但计时器没起（要手动 暂停→继续 才走），按 state 判断会凭空算掉时间
        running: timerId !== undefined && currentDeadline !== null,
        now: Date.now(),
        deadline: currentDeadline,
        owner: RUNTIME_OWNER,
    });
    try {
        void Promise.resolve(chrome.storage.local.set({ [POMODORO_RUNTIME_KEY]: payload })).catch(
            (error: unknown) => {
                log.warn('[pomodoro] 运行态写入失败:', (error as Error)?.message ?? error);
            }
        );
    } catch (error) {
        log.warn('[pomodoro] 运行态写入失败:', (error as Error)?.message ?? error);
    }
}

function clearTimer(): void {
    clearInterval(timerId);
    timerId = undefined;
}

/** 按当前 remainingSeconds 起表（恢复路径不调用 tick，避免又白扣一秒） */
function armTimer(): void {
    clearTimer();
    timerId = setInterval(tick, 1000);
}

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
    if (currentDeadline !== null) {
        // 以绝对截止时间为唯一真源：setInterval 在后台标签页会被节流到秒级甚至分钟级，
        // 逐秒自减只会越走越慢，而 deadline 现算能把整段时间一次性追平
        remainingSeconds.value = Math.max(0, Math.ceil((currentDeadline - Date.now()) / 1000));
    } else {
        // start() 的首次调用没有 deadline（legacy 立即扣一秒的行为），暂按时长自减
        remainingSeconds.value -= 1;
    }
    if (remainingSeconds.value <= 0) {
        completePhase();
        return;
    }
}

function completePhase(): void {
    clearInterval(timerId);
    timerId = undefined;
    currentDeadline = null;
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
    writeRuntime();
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
    userTouchedRuntime = true;
    if (state.value === 'working' || state.value === 'resting') return;
    if (state.value === 'paused') {
        state.value = pausedFrom; // 恢复到暂停前的阶段
    } else if (state.value === 'idle') {
        phaseType.value = 'work';
        state.value = 'working';
        remainingSeconds.value = settings.value.workMinutes * 60;
    }
    const stateBeforeTick = state.value;
    tick();
    // tick 恰好把阶段跑完时 completePhase 已经接管（自己摆好休息/空闲态）：
    // 这里再起表会把「进入休息」的阶段也逐秒扣掉，破坏 legacy 的休息不自动计时
    if (state.value !== stateBeforeTick) return;
    // deadline 在 tick 之后按剩余秒数重算，保证「恢复出来的 23:40」不会被
    // 写盘路径上的旧 deadline 拉回去
    currentDeadline = Date.now() + Math.max(1, remainingSeconds.value) * 1000;
    timerId = setInterval(tick, 1000);
    writeRuntime();
}

/** 暂停（legacy pause） */
function pause(): void {
    userTouchedRuntime = true;
    if (state.value !== 'working' && state.value !== 'resting') return;
    pausedFrom = state.value;
    state.value = 'paused';
    clearInterval(timerId);
    timerId = undefined;
    currentDeadline = null;
    writeRuntime();
}

/** 重置回初始专注阶段（legacy reset） */
function reset(): void {
    userTouchedRuntime = true;
    clearInterval(timerId);
    timerId = undefined;
    currentDeadline = null;
    state.value = 'idle';
    phaseType.value = 'work';
    remainingSeconds.value = settings.value.workMinutes * 60;
    writeRuntime();
}

/** 跳过当前阶段（不计数，直接进入下一阶段；legacy skipPhase） */
function skipPhase(): void {
    userTouchedRuntime = true;
    if (state.value === 'idle') return;
    clearInterval(timerId);
    timerId = undefined;
    currentDeadline = null;
    if (phaseType.value === 'work') {
        enterBreak(false); // 跳过专注不计数，进短休
    } else {
        state.value = 'idle';
        phaseType.value = 'work';
        remainingSeconds.value = settings.value.workMinutes * 60;
        notifyComplete('work');
    }
    writeRuntime();
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

// ---------- 冷启动恢复与跨标签页同步 ----------

/**
 * 把一帧记录摆到状态机上。
 *
 * 与 completePhase 的差异：这里不重放声音以外的副作用链，而是直接采纳
 * recoverRuntime 算好的结果——因为恢复时可能已经跨了多个阶段，重放会乱。
 */
function applyRuntime(record: PomodoroRuntimeRecord, announce: boolean): void {
    const config: PomodoroRecoveryConfig = {
        workMinutes: settings.value.workMinutes,
        breakMinutes: settings.value.breakMinutes,
        longBreakMinutes: settings.value.longBreakMinutes,
        roundsBeforeLongBreak: settings.value.roundsBeforeLongBreak,
        cycleCount: stats.value.cycleCount || 0,
    };
    const plan = recoverRuntime(record, config, Date.now());

    clearTimer();
    state.value = plan.state;
    phaseType.value = plan.phaseType;
    pausedFrom = plan.pausedFrom;
    remainingSeconds.value = plan.remainingSeconds;

    if (plan.completedWork) {
        // 离开期间到点的那次专注要补记，否则统计口径会默默少算一轮
        stats.value.cycleCount = (stats.value.cycleCount || 0) + 1;
        stats.value.completedToday = (stats.value.completedToday || 0) + 1;
        stats.value.totalAllTime = (stats.value.totalAllTime || 0) + 1;
    }

    if (plan.keepRunning && typeof record.deadline === 'number') {
        // 沿用原来的截止时间：新的标签页不该把 deadline 往后推
        currentDeadline = record.deadline;
        armTimer();
    } else {
        currentDeadline = null;
    }

    if (announce && plan.advancedTo) {
        showToast(PHASE_MESSAGES[plan.advancedTo], 'success', 4000);
    }
}

async function readRuntime(): Promise<PomodoroRuntimeRecord | null> {
    try {
        const result = await chrome.storage.local.get([POMODORO_RUNTIME_KEY]);
        return normalizeRuntime(result?.[POMODORO_RUNTIME_KEY]);
    } catch (error) {
        log.warn('[pomodoro] 运行态读取失败:', (error as Error)?.message ?? error);
        return null;
    }
}

function bindRuntimeSync(): void {
    if (runtimeListenerBound) return;
    runtimeListenerBound = true;
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[POMODORO_RUNTIME_KEY]) return;
            const record = normalizeRuntime(changes[POMODORO_RUNTIME_KEY].newValue);
            if (!record) return;
            // 自己写的回声不处理：否则每次落盘都会把正在跑的计时器重建一次
            if (record.owner && record.owner === RUNTIME_OWNER) return;
            applyRuntime(record, true);
        });
    } catch (error) {
        log.warn('[pomodoro] 跨标签页同步绑定失败:', (error as Error)?.message ?? error);
    }
}

/**
 * 冷启动入口：等 settings/stats 水合 → 读运行态 → 摆状态 → 放开写盘闸门。
 *
 * 顺序不能反：先水合再恢复，否则算出来的阶段时长和长休息判定都是默认值。
 */
async function initRuntime(): Promise<void> {
    await Promise.all([whenStoredHydrated(settings), whenStoredHydrated(stats)]);
    bindRuntimeSync();
    const record = await readRuntime();
    // 用户在异步窗口里已经操作过：内存状态优先，不拿旧记录回滚
    if (record && !userTouchedRuntime) applyRuntime(record, true);
    runtimeReady = true;
    // 恢复完立刻落一帧：首次安装建立基线，跨阶段恢复后把结算结果写回去
    writeRuntime();
}

// ---------- 派生状态（legacy render/getProgress/getStateLabel 的响应式版） ----------

/** 阶段总时长（秒）（legacy getPhaseTotalSeconds） */
const phaseTotalSeconds = computed<number>(() => phaseSeconds(phaseType.value, settings.value));

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

// 冻结标签页回来时按 deadline 一次性补算：后台定时器被浏览器节流/冻结期间
// 一秒都没走，这里把它「追平」，而不是让用户看到停在 12:00 的假象。
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (timerId === undefined || currentDeadline === null) return;
        const remaining = Math.ceil((currentDeadline - Date.now()) / 1000);
        if (remaining <= 0) {
            completePhase();
            return;
        }
        remainingSeconds.value = remaining;
    });
}

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
    /**
     * 冷启动恢复入口。单例创建时已自动调用一次；只有需要「等恢复完成后再读状态」
     * 的调用方（例如测试或首屏骨架）才需要显式 await。
     */
    initRuntime: () => Promise<void>;
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
            initRuntime,
        };
        // 单例一建立就恢复：面板/卡片拿到的是接续过的状态，而不是默认 25:00
        void initRuntime();
    }
    return api;
}
