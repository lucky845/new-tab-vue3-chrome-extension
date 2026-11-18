import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * canvas-readback 的安装状态是模块级的（installed 布尔），所以每个用例都要
 * resetModules 后重新 import，否则第二个用例拿到的 prototype 没被包装过。
 *
 * vitest 是 node 环境、没有真实 DOM：这里桩一个最小 HTMLCanvasElement.prototype，
 * 只验证 getContext 的分支判断（是否补标志、是否保留调用方选项、是否幂等），
 * 不模拟真实渲染管线。
 */

interface CanvasStub {
    isConnected: boolean;
    getContext: (id: string, opts?: Record<string, unknown>) => unknown;
}

interface PrototypeHolder {
    HTMLCanvasElement: { prototype: { getContext: (this: unknown, id: string, opts?: unknown) => unknown } };
}

const g = globalThis as unknown as PrototypeHolder;

function installProto(): { calls: { id: string; opts: unknown }[] } {
    const calls: { id: string; opts: unknown }[] = [];
    const proto = {
        getContext(this: CanvasStub, id: string, opts?: unknown) {
            calls.push({ id, opts });
            return { id, opts };
        },
    };
    const holder = globalThis as unknown as { HTMLCanvasElement?: { prototype: unknown } };
    if (!holder.HTMLCanvasElement) {
        vi.stubGlobal('HTMLCanvasElement', function HTMLCanvasElement() {} as unknown);
    }
    (holder.HTMLCanvasElement as { prototype: unknown }).prototype = proto;
    return { calls };
}

function el(isConnected: boolean): CanvasStub {
    const calls: { id: string; opts: unknown }[] = [];
    return {
        isConnected,
        getContext(id: string, opts?: Record<string, unknown>) {
            calls.push({ id, opts });
            return { id, opts };
        },
    };
}

async function freshInstall(): Promise<void> {
    vi.resetModules();
    const mod = await import('@/src/lib/canvas-readback');
    mod.installCanvasReadbackHint();
}

describe('installCanvasReadbackHint', () => {
    let calls: { id: string; opts: unknown }[];

    beforeEach(() => {
        calls = installProto().calls;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        delete (globalThis as unknown as { HTMLCanvasElement?: unknown }).HTMLCanvasElement;
    });

    const get = (canvas: CanvasStub, id: string, opts?: Record<string, unknown>) =>
        g.HTMLCanvasElement.prototype.getContext.call(canvas, id, opts);

    it('离屏 2d canvas 自动补 willReadFrequently', async () => {
        await freshInstall();
        get(el(false), '2d');
        expect(calls).toHaveLength(1);
        expect(calls[0].opts).toEqual({ willReadFrequently: true });
    });

    it('已插入文档的 canvas 保持 GPU 后端，不补标志', async () => {
        await freshInstall();
        get(el(true), '2d');
        expect(calls[0].opts).toBeUndefined();
    });

    it('webgl 上下文完全不受影响', async () => {
        await freshInstall();
        get(el(false), 'webgl2', { alpha: false });
        expect(calls[0]).toEqual({ id: 'webgl2', opts: { alpha: false } });
    });

    it('调用方显式给出 willReadFrequently 时不覆盖', async () => {
        await freshInstall();
        get(el(false), '2d', { willReadFrequently: false });
        expect(calls[0].opts).toEqual({ willReadFrequently: false });
    });

    it('保留调用方传入的其它 2d 选项', async () => {
        await freshInstall();
        get(el(false), '2d', { alpha: false });
        expect(calls[0].opts).toEqual({ alpha: false, willReadFrequently: true });
    });

    it('重复安装不会叠加包装（幂等）', async () => {
        vi.resetModules();
        const mod = await import('@/src/lib/canvas-readback');
        mod.installCanvasReadbackHint();
        const wrapped = g.HTMLCanvasElement.prototype.getContext;
        mod.installCanvasReadbackHint();
        mod.installCanvasReadbackHint();
        expect(g.HTMLCanvasElement.prototype.getContext).toBe(wrapped);
    });

    it('没有 HTMLCanvasElement 时静默跳过，不抛错', async () => {
        vi.unstubAllGlobals();
        delete (globalThis as unknown as { HTMLCanvasElement?: unknown }).HTMLCanvasElement;
        vi.resetModules();
        const mod = await import('@/src/lib/canvas-readback');
        expect(() => mod.installCanvasReadbackHint()).not.toThrow();
    });
});
