import { describe, expect, it } from 'vitest';
import {
    MOTION_LS_MIRROR,
    normalizeMotionMirror,
    resolveMotionMode,
} from '@/src/lib/motionPreference';

describe('resolveMotionMode', () => {
    it('默认（未开开关、系统未降级）保持完整动效', () => {
        expect(resolveMotionMode(false, false)).toBe('full');
        expect(resolveMotionMode(undefined, false)).toBe('full');
    });

    it('用户开关单独成立即降级', () => {
        expect(resolveMotionMode(true, false)).toBe('reduced');
    });

    it('系统偏好单独成立即降级', () => {
        expect(resolveMotionMode(false, true)).toBe('reduced');
    });

    it('开关不能覆盖系统的降级偏好（只能更保守）', () => {
        expect(resolveMotionMode(true, true)).toBe('reduced');
    });
});

describe('normalizeMotionMirror', () => {
    it('只接受显式 true', () => {
        expect(normalizeMotionMirror({ reduceMotion: true })).toEqual({ reduceMotion: true });
        expect(normalizeMotionMirror({ reduceMotion: false })).toEqual({ reduceMotion: false });
    });

    it('脏数据 / 缺键一律不降级', () => {
        for (const raw of [null, undefined, {}, 'yes', 1, { reduceMotion: 'true' }, { reduceMotion: 1 }]) {
            expect(normalizeMotionMirror(raw)).toEqual({ reduceMotion: false });
        }
    });

    it('镜像键与 preboot 读取的键一致', () => {
        expect(MOTION_LS_MIRROR).toBe('ntce-motion');
    });
});
