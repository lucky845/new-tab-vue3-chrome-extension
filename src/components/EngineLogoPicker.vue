<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { firstCharOf, isDataImage } from '@/src/lib/iconSafe';

/**
 * 引擎 logo 选择器：选一张图 → 拖拽/滚轮调整取景 → 换成 128×128 的方形图标。
 *
 * 为什么默认铺满（cover）而不是缩小整张：引擎的「logo」通常是站点 favicon 或
 * 网站截图，用户要的是其中的一枚图形，不是把整张图缩进去。铺满后拖一拖就能把
 * 目标图形框进方形里，这就是「自动裁剪」的手感；提交时再按同样的正方形取景把
 * 原图画进一张 128×128 的 data URL，存下来的就是裁好的结果。
 *
 * 输出固定 128×128：图标最多显示 44px（下拉 18 / 搜索框 22 / 设置列表 26），
 * 128 已覆盖 3 倍屏，再大只是白占 chrome.storage。
 */
const props = withDefaults(
    defineProps<{
        /** 没选图时展示的兜底文字（通常是引擎名首字） */
        name?: string;
        /** 该引擎当前已存的 logo（data URL），为空表示还没设过 */
        currentLogo?: string;
    }>(),
    { name: '', currentLogo: '' },
);

const emit = defineEmits<{
    /** logo 为 undefined 表示清空（顶层回落到 favicon / 首字） */
    (e: 'update', logo: string | undefined): void;
}>();

const SIZE = 128;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * 粘贴剪贴板里的图片（截图直接 Ctrl+V 最省事）。读剪贴板需要用户手势，
 * 所以只挂在按钮的 click 上，不在挂载时自动请求权限。
 */
async function pasteFromClipboard(): Promise<void> {
    const clip = navigator.clipboard as Clipboard | undefined;
    if (!clip || typeof clip.read !== 'function') {
        errorText.value = '当前浏览器不支持读取剪贴板，请点「上传图片」';
        return;
    }
    try {
        const items = await clip.read();
        for (const item of items) {
            const file = item.types.find((t) => /^image\//.test(t));
            if (!file) continue;
            const blob = await item.getType(file);
            loadFile(new File([blob], 'clipboard', { type: file }));
            return;
        }
        errorText.value = '剪贴板里没有图片';
    } catch {
        errorText.value = '读取剪贴板被拒绝，请点「上传图片」';
    }
}

const inputEl = ref<HTMLInputElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const image = ref<{ src: string; w: number; h: number } | null>(null);
/** 相对「铺满」位置的偏移，单位是预览像素 */
const offset = ref({ x: 0, y: 0 });
const zoom = ref(1);
const dragging = ref(false);
const errorText = ref('');
/** 用户已经裁过一次：此时预览显示裁好的结果 */
const result = ref('');

const fallbackChar = computed(() => firstCharOf(props.name));

/** 预览区边长（CSS 定死 128px），只在这里读一次避免每帧 layout */
const stageSize = 128;

/** 铺满所需的基础缩放：短边刚好盖住预览方框 */
const baseScale = computed(() => {
    const img = image.value;
    if (!img) return 1;
    return Math.max(stageSize / img.w, stageSize / img.h);
});

const preview = computed(() => {
    const img = image.value;
    if (!img) return null;
    const scale = baseScale.value * zoom.value;
    return {
        width: img.w * scale,
        height: img.h * scale,
        // 居中铺满 + 用户偏移
        left: (stageSize - img.w * scale) / 2 + offset.value.x,
        top: (stageSize - img.h * scale) / 2 + offset.value.y,
    };
});

/** 偏移夹紧：不让图片边缘缩进方框内（否则会露出空白） */
function clampOffset(): void {
    const img = image.value;
    const p = preview.value;
    if (!img || !p) return;
    const maxX = Math.max(0, (p.width - stageSize) / 2);
    const maxY = Math.max(0, (p.height - stageSize) / 2);
    offset.value = {
        x: Math.min(maxX, Math.max(-maxX, offset.value.x)),
        y: Math.min(maxY, Math.max(-maxY, offset.value.y)),
    };
}

function pickFile(): void {
    inputEl.value?.click();
}

function onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) loadFile(file);
}

function loadFile(file: File): void {
    if (!/^image\//.test(file.type)) {
        errorText.value = '只支持图片文件';
        return;
    }
    if (file.size > MAX_FILE_BYTES) {
        errorText.value = '图片不要超过 4MB';
        return;
    }
    errorText.value = '';
    const reader = new FileReader();
    reader.onload = () => {
        const src = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
            image.value = { src, w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
            offset.value = { x: 0, y: 0 };
            zoom.value = 1;
            result.value = '';
        };
        img.onerror = () => {
            errorText.value = '这张图读不出来';
        };
        img.src = src;
    };
    reader.onerror = () => {
        errorText.value = '读取文件失败';
    };
    reader.readAsDataURL(file);
}

/* ---------- 拖拽取景（指针事件，触屏与鼠标同一套） ---------- */
let startPoint: { x: number; y: number } | null = null;
let startOffset = { x: 0, y: 0 };

function onPointerDown(event: PointerEvent): void {
    if (!image.value) return;
    dragging.value = true;
    startPoint = { x: event.clientX, y: event.clientY };
    startOffset = { ...offset.value };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
    if (!dragging.value || !startPoint) return;
    offset.value = {
        x: startOffset.x + (event.clientX - startPoint.x),
        y: startOffset.y + (event.clientY - startPoint.y),
    };
    clampOffset();
}

function onPointerUp(event: PointerEvent): void {
    if (!dragging.value) return;
    dragging.value = false;
    startPoint = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
}

function onWheel(event: WheelEvent): void {
    if (!image.value) return;
    event.preventDefault();
    const next = zoom.value * (event.deltaY < 0 ? 1.1 : 1 / 1.1);
    zoom.value = Math.min(4, Math.max(1, Number(next.toFixed(3))));
    clampOffset();
}

onBeforeUnmount(() => {
    image.value = null;
});

/** 撤销：清掉 logo，并把品牌 SVG 补回去（自定义引擎没有品牌，退回首字） */
function clearLogo(): void {
    image.value = null;
    result.value = '';
    errorText.value = '';
    emit('update', undefined);
}

/** 从已有 logo 重新调整：把存下的 data URL 当成新图再裁一次 */
async function reopen(current: string): Promise<void> {
    if (!isDataImage(current)) return;
    const img = new Image();
    img.onload = () => {
        image.value = { src: current, w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
        offset.value = { x: 0, y: 0 };
        zoom.value = 1;
        result.value = '';
    };
    img.src = current;
}

/** 把当前取景画进 128×128：与预览同一套坐标，所见即所得 */
function commit(): void {
    const img = image.value;
    const p = preview.value;
    if (!img || !p) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        errorText.value = '浏览器不支持画布裁剪';
        return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const source = new Image();
    source.onload = () => {
        // 预览用的是 CSS 像素，画布是 128 的原尺寸：按 SIZE/stageSize 缩放绘制
        const k = SIZE / stageSize;
        ctx.drawImage(source, p.left * k, p.top * k, p.width * k, p.height * k);
        result.value = canvas.toDataURL('image/png');
        // 有了自己的 logo 就不再需要品牌 SVG，否则引擎图标仍然优先显示品牌
        emit('update', result.value);
    };
    source.onerror = () => {
        errorText.value = '裁剪失败，换一张图试试';
    };
    source.src = img.src;
}

</script>

<template>
    <div class="logo-picker">
        <input
            ref="inputEl"
            type="file"
            accept="image/*"
            class="u-hidden"
            aria-hidden="true"
            tabindex="-1"
            @change="onFileChange"
        />

        <div class="logo-picker-row">
            <div
                ref="stageEl"
                class="logo-stage"
                :class="{ 'is-dragging': dragging, 'is-empty': !image }"
                role="img"
                :aria-label="image ? '拖动调整图标取景' : '引擎图标预览'"
                @pointerdown="onPointerDown"
                @pointermove="onPointerMove"
                @pointerup="onPointerUp"
                @pointercancel="onPointerUp"
                @wheel="onWheel"
            >
                <img
                    v-if="image && preview"
                    class="logo-stage-image"
                    :src="image.src"
                    alt=""
                    draggable="false"
                    :style="{
                        width: preview.width + 'px',
                        height: preview.height + 'px',
                        left: preview.left + 'px',
                        top: preview.top + 'px',
                    }"
                />
                <img
                    v-else-if="currentLogo"
                    class="logo-stage-image"
                    :src="currentLogo"
                    alt=""
                    draggable="false"
                    :style="{ width: stageSize + 'px', height: stageSize + 'px', left: 0, top: 0 }"
                />
                <span v-else class="logo-stage-fallback">{{ fallbackChar }}</span>
                <span v-if="!image && !currentLogo && !result" class="logo-stage-hint">上传图片</span>
            </div>

            <div class="logo-picker-actions">
                <button type="button" class="settings-btn" @click="pickFile">
                    {{ image ? '换一张' : '上传图片' }}
                </button>
                <button type="button" class="logo-reset" @click="pasteFromClipboard">粘贴剪贴板图片</button>
                <button v-if="image" type="button" class="settings-btn" @click="commit">裁剪并应用</button>
                <button v-if="image || result" type="button" class="logo-reset" @click="clearLogo">恢复默认</button>
                <button v-if="currentLogo && !image" type="button" class="logo-reset" @click="reopen(currentLogo)">
                    调整当前图标
                </button>
                <p v-if="errorText" class="logo-error">{{ errorText }}</p>
                <p v-else-if="image" class="logo-hint">拖动图片调整位置，滚轮缩放，满意后点「裁剪并应用」</p>
                <p v-else-if="currentLogo" class="logo-hint">当前用的是自定义图标，可重新调整或恢复默认</p>
                <p v-else class="logo-hint">不设置时用引擎自带图标，没有就用名字首字</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.logo-picker {
    margin: 10px 0 4px;
}

.logo-picker-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;
}

.logo-stage {
    position: relative;
    width: 128px;
    height: 128px;
    flex: 0 0 128px;
    overflow: hidden;
    border-radius: 22%;
    border: 1px solid var(--surface-border);
    background-color: var(--surface-2);
    cursor: grab;
    touch-action: none;
    user-select: none;
}

.logo-stage.is-dragging {
    cursor: grabbing;
}

.logo-stage.is-empty {
    cursor: default;
    border-style: dashed;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
}

.logo-stage-image {
    position: absolute;
    max-width: none;
    pointer-events: none;
}

.logo-stage-fallback {
    font-size: 44px;
    font-weight: 600;
    color: var(--text-secondary);
    line-height: 1;
}

.logo-stage-hint {
    font-size: 11px;
    color: var(--text-muted);
}

.logo-picker-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
}

.logo-picker-actions .settings-btn {
    height: 32px;
}

.logo-reset {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
}

.logo-reset:hover {
    color: var(--text-primary);
}

.logo-hint,
.logo-error {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
}

.logo-error {
    color: #ff6b6b;
}
</style>
