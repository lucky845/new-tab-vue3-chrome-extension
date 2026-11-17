import { describe, it, expect } from 'vitest';
import {
    POMODORO_RUNTIME_KEY,
    makeRuntimeRecord,
    normalizeRuntime,
    phaseSeconds,
    recoverRuntime,
    type PomodoroRecoveryConfig,
    type PomodoroRuntimeRecord,
} from '@/src/lib/pomodoroRuntime';

const CONFIG: PomodoroRecoveryConfig = {
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    roundsBeforeLongBreak: 4,
    cycleCount: 0,
};

const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;

function record(partial: Partial<PomodoroRuntimeRecord>): PomodoroRuntimeRecord {
    return {
        state: 'working',
        phaseType: 'work',
        pausedFrom: 'working',
        remainingSeconds: 600,
        savedAt: 0,
        deadline: null,
        owner: 'pm-test',
        ...partial,
    };
}

describe('pomodoroRuntime 常量与阶段时长', () => {
    it('storage 键与备份/PRIVACY 文档口径一致', () => {
        expect(POMODORO_RUNTIME_KEY).toBe('pomodoroRuntime');
    });

    it('phaseSeconds 按阶段取分钟数，非法值兜底到 1 分钟', () => {
        expect(phaseSeconds('work', CONFIG)).toBe(WORK_SECONDS);
        expect(phaseSeconds('break', CONFIG)).toBe(BREAK_SECONDS);
        expect(phaseSeconds('longBreak', CONFIG)).toBe(LONG_BREAK_SECONDS);
        expect(phaseSeconds('work', { ...CONFIG, workMinutes: 0 })).toBe(60);
        expect(phaseSeconds('break', { ...CONFIG, breakMinutes: -3 })).toBe(60);
    });
});

describe('normalizeRuntime 洗数据', () => {
    it('非对象、数组、缺关键字段一律当作没有运行态', () => {
        expect(normalizeRuntime(null)).toBeNull();
        expect(normalizeRuntime(undefined)).toBeNull();
        expect(normalizeRuntime('working')).toBeNull();
        expect(normalizeRuntime([])).toBeNull();
        expect(normalizeRuntime({ state: 'working' })).toBeNull();
        expect(normalizeRuntime({ phaseType: 'work' })).toBeNull();
        expect(normalizeRuntime({ state: 'napping', phaseType: 'work' })).toBeNull();
        expect(normalizeRuntime({ state: 'working', phaseType: 'nap' })).toBeNull();
        expect(normalizeRuntime({ state: 'working', phaseType: 'work', remainingSeconds: -5 })).toBeNull();
        expect(
            normalizeRuntime({ state: 'working', phaseType: 'work', remainingSeconds: 'abc' })
        ).toBeNull();
    });

    it('合法记录保留数值，缺失的可选字段补默认值', () => {
        expect(normalizeRuntime(record({ remainingSeconds: 42, savedAt: 1000, deadline: 2000 }))).toEqual({
            state: 'working',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: 42,
            savedAt: 1000,
            deadline: 2000,
            owner: 'pm-test',
        });

        const sparse = normalizeRuntime({ state: 'idle', phaseType: 'work', remainingSeconds: 0 });
        expect(sparse).toEqual({
            state: 'idle',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: 0,
            savedAt: 0,
            deadline: null,
            owner: '',
        });
    });
});

describe('recoverRuntime 恢复分支', () => {
    it('暂停态原样接回，不启动计时', () => {
        const plan = recoverRuntime(
            record({ state: 'paused', pausedFrom: 'working', remainingSeconds: 321, deadline: null }),
            CONFIG,
            999_999
        );
        expect(plan).toEqual({
            state: 'paused',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: 321,
            completedWork: false,
            keepRunning: false,
            advancedTo: null,
        });
    });

    it('暂停态的剩余秒数超过阶段总长时按总长收紧', () => {
        const plan = recoverRuntime(
            record({ state: 'paused', pausedFrom: 'working', remainingSeconds: WORK_SECONDS + 600 }),
            CONFIG,
            0
        );
        expect(plan.remainingSeconds).toBe(WORK_SECONDS);
    });

    it('运行中且未到点：按 deadline 现算剩余并继续跑', () => {
        const now = 1_000_000;
        const plan = recoverRuntime(
            record({ state: 'working', remainingSeconds: 600, savedAt: now - 60_000, deadline: now + 90_500 }),
            CONFIG,
            now
        );
        // 90.5 秒向上取整，避免最后一秒提前归零
        expect(plan.remainingSeconds).toBe(91);
        expect(plan.keepRunning).toBe(true);
        expect(plan.completedWork).toBe(false);
        expect(plan.advancedTo).toBeNull();
        expect(plan.state).toBe('working');
        expect(plan.phaseType).toBe('work');
    });

    it('运行中且剩余不足 1 秒时向下兜到 1，不返回 0', () => {
        const now = 1_000_000;
        const plan = recoverRuntime(
            record({ state: 'working', deadline: now + 400 }),
            CONFIG,
            now
        );
        expect(plan.remainingSeconds).toBe(1);
        expect(plan.keepRunning).toBe(true);
    });

    it('专注阶段在离开期间到点：补记一轮并进入短休息（不自动计时）', () => {
        const now = 2_000_000;
        const plan = recoverRuntime(
            record({ state: 'working', phaseType: 'work', cycleCount: 0, deadline: now - 1 }),
            CONFIG,
            now
        );
        // cycleCount 0 → 结算成 1，1 % 4 !== 0，走短休息
        expect(plan).toEqual({
            state: 'resting',
            phaseType: 'break',
            pausedFrom: 'resting',
            remainingSeconds: BREAK_SECONDS,
            completedWork: true,
            keepRunning: false,
            advancedTo: 'break',
        });
    });

    it('专注阶段到点且正好填满一轮：进长休息', () => {
        const now = 2_000_000;
        const plan = recoverRuntime(
            record({ state: 'working', phaseType: 'work', deadline: now - 1 }),
            { ...CONFIG, cycleCount: 3 },
            now
        );
        // 3 + 1 = 4，4 % 4 === 0
        expect(plan.phaseType).toBe('longBreak');
        expect(plan.remainingSeconds).toBe(LONG_BREAK_SECONDS);
        expect(plan.advancedTo).toBe('longBreak');
        expect(plan.completedWork).toBe(true);
    });

    it('休息阶段在离开期间到点：回到 idle 的下一轮专注', () => {
        const now = 2_000_000;
        const plan = recoverRuntime(
            record({
                state: 'resting',
                phaseType: 'longBreak',
                pausedFrom: 'resting',
                deadline: now - 1,
            }),
            CONFIG,
            now
        );
        expect(plan).toEqual({
            state: 'idle',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: WORK_SECONDS,
            completedWork: false,
            keepRunning: false,
            advancedTo: 'work',
        });
    });

    it('休息阶段进入后计时器没起（deadline 为 null）：原样接回，不算掉时间', () => {
        const plan = recoverRuntime(
            record({
                state: 'resting',
                phaseType: 'break',
                pausedFrom: 'resting',
                remainingSeconds: BREAK_SECONDS,
                deadline: null,
            }),
            CONFIG,
            9_999_999
        );
        expect(plan.state).toBe('resting');
        expect(plan.remainingSeconds).toBe(BREAK_SECONDS);
        expect(plan.keepRunning).toBe(false);
        expect(plan.advancedTo).toBeNull();
    });

    it('空闲态：剩余秒数回到工作阶段总长', () => {
        const plan = recoverRuntime(
            record({ state: 'idle', phaseType: 'longBreak', remainingSeconds: 3 }),
            CONFIG,
            0
        );
        expect(plan.state).toBe('idle');
        expect(plan.phaseType).toBe('work');
        expect(plan.remainingSeconds).toBe(WORK_SECONDS);
        expect(plan.keepRunning).toBe(false);
    });
});

describe('makeRuntimeRecord 组帧', () => {
    const NOW = 1_700_000_000_000;

    it('运行中且给定 deadline 时续写原值，不产生漂移', () => {
        const first = makeRuntimeRecord({
            state: 'working',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: 600,
            running: true,
            now: NOW,
        });
        expect(first.deadline).toBe(NOW + 600_000);

        // 十秒后再落一帧：沿用同一个 deadline，而不是 NOW+10s+590s
        const second = makeRuntimeRecord({
            state: 'working',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: 590,
            running: true,
            now: NOW + 10_000,
            deadline: first.deadline,
        });
        expect(second.deadline).toBe(first.deadline);
        expect(second.savedAt).toBe(NOW + 10_000);
    });

    it('未运行（暂停/空闲）时 deadline 恒为 null，即使传了值', () => {
        const rec = makeRuntimeRecord({
            state: 'paused',
            phaseType: 'work',
            pausedFrom: 'working',
            remainingSeconds: 300,
            running: false,
            now: NOW,
            deadline: NOW + 300_000,
        });
        expect(rec.deadline).toBeNull();
    });

    it('剩余秒数取整并夹到非负，owner 缺省为空串', () => {
        const rec = makeRuntimeRecord({
            state: 'paused',
            phaseType: 'break',
            pausedFrom: 'resting',
            remainingSeconds: -12.7,
            running: false,
            now: NOW,
        });
        expect(rec.remainingSeconds).toBe(0);
        expect(rec.owner).toBe('');
    });
});
