/**
 * 番茄钟「运行态」的持久化模型（纯函数，不 import vue / 不碰 chrome）。
 *
 * 为什么单独一个模块：`usePomodoro` 里的计时状态是模块级单例，进程一走就没了
 * （新标签页、浏览器重启、扩展更新都会重建）。要把「正在跑的 24:13」跨上下文
 * 接回来，必须把**绝对截止时间**存下来，而不是只存剩余秒数——只存剩余秒数的话，
 * 闭合标签页期间流逝的时间就永远算不回来了。
 *
 * 零权限方案：只用 chrome.storage.local，不申请 alarms / notifications。
 * 代价是「后台标签页被浏览器冻结时不能准点响铃」，补偿手段是页面重新可见时
 * 按 deadline 结算（见 `recoverRuntime`）。
 */

/** 运行态在 storage 里的键（备份注册表与 doc/PRIVACY.md 必须同步） */
export const POMODORO_RUNTIME_KEY = 'pomodoroRuntime';

export type PomodoroState = 'idle' | 'working' | 'resting' | 'paused';
export type PomodoroPhaseType = 'work' | 'break' | 'longBreak';

/** 运行中可被冻结/恢复的两个状态；暂停与空闲不参与 deadline 计算 */
export type PomodoroActiveState = 'working' | 'resting';

/** 落盘的一帧运行态 */
export interface PomodoroRuntimeRecord {
    state: PomodoroState;
    phaseType: PomodoroPhaseType;
    /** 暂停前所处的活动阶段，恢复暂停/继续时用 */
    pausedFrom: PomodoroActiveState;
    /** 写入瞬间的剩余秒数（暂停态直接拿它恢复） */
    remainingSeconds: number;
    /** 写入瞬间的时间戳（毫秒），用于判断记录有多旧 */
    savedAt: number;
    /** 运行中 = savedAt + remainingSeconds * 1000；暂停/空闲 = null */
    deadline: number | null;
    /** 写这一帧的上下文标识，仅用于辨认「这是不是我自己的回声」，不参与归属判定 */
    owner: string;
}

/** 恢复所需的外部事实：阶段时长 + 当前轮次（决定长/短休息） */
export interface PomodoroRecoveryConfig {
    workMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    roundsBeforeLongBreak: number;
    /** 恢复前的 cycleCount，判定长休息用 */
    cycleCount: number;
}

/** 恢复结果：调用方按它一次性把状态机摆到位 */
export interface PomodoroRecoveryPlan {
    state: PomodoroState;
    phaseType: PomodoroPhaseType;
    pausedFrom: PomodoroActiveState;
    remainingSeconds: number;
    /** 是否要补记一次完成的专注（离开期间到点了） */
    completedWork: boolean;
    /** 是否为「运行中且还要继续跑」，调用方据此决定是否启动 interval */
    keepRunning: boolean;
    /** 阶段在离开期间完成、已进入的下一阶段（调用方可用于静默提示） */
    advancedTo: PomodoroPhaseType | null;
}

/** 某阶段的总秒数 */
export function phaseSeconds(
    phaseType: PomodoroPhaseType,
    config: Pick<PomodoroRecoveryConfig, 'workMinutes' | 'breakMinutes' | 'longBreakMinutes'>
): number {
    if (phaseType === 'break') return Math.max(1, config.breakMinutes) * 60;
    if (phaseType === 'longBreak') return Math.max(1, config.longBreakMinutes) * 60;
    return Math.max(1, config.workMinutes) * 60;
}

function isActiveState(value: unknown): value is PomodoroActiveState {
    return value === 'working' || value === 'resting';
}

function isPhaseType(value: unknown): value is PomodoroPhaseType {
    return value === 'work' || value === 'break' || value === 'longBreak';
}

/** 把任意落盘内容洗成合法记录；洗不动返回 null（当成「没有运行态」） */
export function normalizeRuntime(raw: unknown): PomodoroRuntimeRecord | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (!isPhaseType(obj.phaseType)) return null;
    const state = obj.state;
    if (state !== 'idle' && state !== 'paused' && !isActiveState(state)) return null;
    const remaining = Math.round(Number(obj.remainingSeconds));
    if (!Number.isFinite(remaining) || remaining < 0) return null;
    const savedAt = Number(obj.savedAt);
    const deadline = obj.deadline === null || obj.deadline === undefined ? null : Number(obj.deadline);
    return {
        state,
        phaseType: obj.phaseType,
        pausedFrom: isActiveState(obj.pausedFrom) ? obj.pausedFrom : 'working',
        remainingSeconds: remaining,
        savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0,
        deadline: Number.isFinite(deadline as number) ? (deadline as number) : null,
        owner: typeof obj.owner === 'string' ? obj.owner : '',
    };
}

/**
 * 按 deadline 把一帧历史记录换算成当前应当呈现的状态。
 *
 * 三条分支：
 * 1. 暂停 / 空闲 / 休息中未计时：原样接回剩余秒数，不启动计时；
 * 2. 运行中且 deadline 未到：`remaining = ceil((deadline - now) / 1000)`，
 *    继续跑（这就是「跨标签页/跨重启接着走」的正解）；
 * 3. 运行中且 deadline 已过：阶段在离开期间完成了，按 completePhase 的语义
 *    结算一次——专注阶段完成则 cycleCount +1 并进入（长/短）休息且**不自动计时**
 *    （legacy 怪癖：休息阶段的倒计时需要手动 暂停→继续 才走），休息阶段完成则
 *    回到 idle 的下一轮专注。只结算一次，因为结算结果不再是「运行中」。
 */
export function recoverRuntime(
    record: PomodoroRuntimeRecord,
    config: PomodoroRecoveryConfig,
    now: number
): PomodoroRecoveryPlan {
    if (record.state === 'paused') {
        const total = phaseSeconds(record.phaseType, config);
        return {
            state: 'paused',
            phaseType: record.phaseType,
            pausedFrom: record.pausedFrom,
            remainingSeconds: Math.min(total, Math.max(1, record.remainingSeconds)),
            completedWork: false,
            keepRunning: false,
            advancedTo: null,
        };
    }

    const running = isActiveState(record.state) && record.deadline !== null;
    if (!running) {
        const total = phaseSeconds(record.phaseType, config);
        const state = record.state === 'idle' ? 'idle' : record.state;
        const remaining =
            state === 'idle'
                ? phaseSeconds('work', config)
                : Math.min(total, Math.max(1, record.remainingSeconds));
        return {
            state,
            phaseType: state === 'idle' ? 'work' : record.phaseType,
            pausedFrom: isActiveState(record.pausedFrom) ? record.pausedFrom : 'working',
            remainingSeconds: remaining,
            completedWork: false,
            keepRunning: false,
            advancedTo: null,
        };
    }

    const deadline = record.deadline as number;
    if (now < deadline) {
        const total = phaseSeconds(record.phaseType, config);
        const remaining = Math.min(total, Math.max(1, Math.ceil((deadline - now) / 1000)));
        return {
            state: record.state,
            phaseType: record.phaseType,
            pausedFrom: record.pausedFrom,
            remainingSeconds: remaining,
            completedWork: false,
            keepRunning: true,
            advancedTo: null,
        };
    }

    // 已过期：阶段在离开期间完成，结算一次
    if (record.phaseType === 'work') {
        const cycles = Math.max(0, Math.round(config.cycleCount)) + 1;
        const rounds = Math.max(1, Math.round(config.roundsBeforeLongBreak));
        const longDue = rounds > 0 && cycles % rounds === 0;
        const nextPhase: PomodoroPhaseType = longDue ? 'longBreak' : 'break';
        return {
            state: 'resting',
            phaseType: nextPhase,
            pausedFrom: 'resting',
            remainingSeconds: phaseSeconds(nextPhase, config),
            completedWork: true,
            keepRunning: false,
            advancedTo: nextPhase,
        };
    }
    return {
        state: 'idle',
        phaseType: 'work',
        pausedFrom: 'working',
        remainingSeconds: phaseSeconds('work', config),
        completedWork: false,
        keepRunning: false,
        advancedTo: 'work',
    };
}

/**
 * 由「当前内存状态」组一帧待落盘记录。
 *
 * running 由调用方显式传入，而不是从 state 推断：休息阶段刚进入时 state 是
 * 'resting' 但计时器没起（legacy 怪癖），这两种情形必须区分开，否则恢复时
 * 会把「还没开始计的休息」凭空算掉几秒。
 */
export function makeRuntimeRecord(input: {
    state: PomodoroState;
    phaseType: PomodoroPhaseType;
    pausedFrom: PomodoroActiveState;
    remainingSeconds: number;
    running: boolean;
    now: number;
    /** 续写既有截止时间时传入，避免每次落盘都把 deadline 往后推（会累积漂移） */
    deadline?: number | null;
    owner?: string;
}): PomodoroRuntimeRecord {
    const remaining = Math.max(0, Math.round(input.remainingSeconds));
    const deadline = input.running
        ? typeof input.deadline === 'number' && Number.isFinite(input.deadline)
            ? input.deadline
            : input.now + remaining * 1000
        : null;
    return {
        state: input.state,
        phaseType: input.phaseType,
        pausedFrom: input.pausedFrom,
        remainingSeconds: remaining,
        savedAt: input.now,
        deadline,
        owner: input.owner ?? '',
    };
}
