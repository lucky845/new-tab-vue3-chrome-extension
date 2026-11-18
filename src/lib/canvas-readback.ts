/**
 * 让「离屏（脱离文档）」canvas 的 2d 上下文默认走 CPU 后端。
 *
 * 背景：不传 willReadFrequently 时，浏览器把 canvas 放在 GPU 上；一旦
 * putImageData / drawImage 之后调 toDataURL 或 getImageData，就必须同步把像素
 * 从 GPU 回读到 CPU 并等待光栅化。冷启动阶段主线程正忙着解析脚本，这个同步等待
 * 会被拉长到几百毫秒甚至 2 秒。
 *
 * @surdeddd/liquidglass v0.12.0 的 encodeLensMap（dist/index.js:929-944）正是这个
 * 模式，且它的 getContext("2d") 没传该标志（同库 dist/index.js:431 传了，属疏漏）。
 * 实测冷启动该函数占 CPU 采样 71.7%，24 次调用累计阻塞超过 5 秒。
 *
 * 为什么不全局无脑加：willReadFrequently 会让 canvas 变成 CPU 后端，逐帧重绘的
 * 动画画布反而更慢。因此这里只对「尚未插入文档」的 canvas 生效——这类画布都是
 * 一次性做像素读回的工具画布（缩略图、蒙版、快照），真正的渲染表面都挂在 DOM 上，
 * 保持 GPU 不动。条件不满足时行为与打补丁前完全一致，不会让任何场景变慢。
 */

let installed = false;

/** 幂等安装；重复调用无副作用。 */
export function installCanvasReadbackHint(): void {
  if (installed) return;
  if (typeof HTMLCanvasElement === 'undefined') return;
  installed = true;

  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;

  proto.getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    contextId: string,
    options?: Record<string, unknown>,
  ) {
    if (contextId === '2d' && !this.isConnected) {
      const merged: Record<string, unknown> =
        options && typeof options === 'object' ? { ...options } : {};
      if (merged.willReadFrequently === undefined) merged.willReadFrequently = true;
      return original.call(this, contextId, merged);
    }
    return original.call(this, contextId, options);
  } as typeof proto.getContext;
}
