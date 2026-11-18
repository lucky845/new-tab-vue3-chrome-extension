<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createIconNode, firstCharOf, isDataImage, siteIconUrl } from '@/src/lib/iconSafe';
import { applyGlass, releaseGlass } from '@/src/lib/glass';

/**
 * 图标方块：主页格子、文件夹预览格、文件夹展开面板共用同一个组件。
 *
 * 为什么不各写一份：这三处的方块必须「同尺寸、同圆角、同材质、同图标占比」，
 * 之前是三份 CSS 各写一遍（86 / 86 / 68px、22% 圆角、24% 白底），
 * 一改主页就漏掉面板。现在几何全由 CSS 变量控制（--icon-square），
 * 材质只有一份，库玻璃也只在这里挂一次。
 *
 * 渲染顺序与历史实现一致，不要调换：
 *   1. 内嵌 SVG（用户在「新增快捷访问」里粘贴的图标）→ 走 iconSafe 消毒后插 DOM
 *   2. 远程图片（http/https 的自定义图标）
 *   3. 站点图标服务（faviconV2，只走 img-src 白名单，不申请 host 权限）
 *   4. 首字兜底
 */

const props = withDefaults(
    defineProps<{
        name?: string;
        url?: string;
        icon?: string | null;
        /** 液态玻璃：主页与文件夹面板都挂，预览格不挂（2×2 里 4 块折射会糊成一团） */
        glass?: boolean;
        /** 首字兜底时是否大写（站点用大写，文件夹预览里用小写） */
        upper?: boolean;
    }>(),
    { name: '', url: '', icon: null, glass: true, upper: true }
);

const slotEl = ref<HTMLElement | null>(null);
/** 图片加载失败才切的兜底；正常路径由 <img> 自己渲染 */
const failed = ref(false);
const svgNode = shallowRef<SVGSVGElement | null>(null);
/** 远程图是否已经画出来：远程图标首帧是空的，加载完再淡入，避免先闪一个灰块 */
const imgReady = ref(false);

const iconText = computed(() => (props.icon || '').trim());
/** 用户裁剪好的 logo 优先：它是「已经确认过的成品」，不该再被 favicon 服务覆盖 */
const logoSrc = computed(() => (isDataImage(iconText.value) ? iconText.value : ''));
const isSvgIcon = computed(() => iconText.value.startsWith('<svg'));
const imgSrc = computed(() => {
    if (logoSrc.value) return logoSrc.value;
    if (/^https?:/.test(iconText.value)) return iconText.value;
    try {
        return siteIconUrl(new URL(props.url || '').hostname);
    } catch {
        return '';
    }
});
const fallbackChar = computed(() => firstCharOf(props.name, props.upper));

/**
 * 图标归一化：站点 favicon 的形状五花八门 ——
 *   · 透明底的图形（Google 三色 G、YouTube 圆角矩形）
 *   · 自带方形底的位图（GitHub 白底黑猫、V2EX 浅灰底深字）
 * 后者直接贴进圆角玻璃方块，会露出「内层方形 + 外层圆角」两层不同心的轮廓，
 * 也就是文件夹弹层里看起来像「两层图标」的元凶。
 *
 * 处理办法不是裁切（会把字标切掉），而是给所有远程图套同一个 squircle 蒙版：
 * 透明底的图形蒙版看不见，方形底则被收成与玻璃同心的一套圆角语言。
 * 蒙版只作用在远程图；用户的 data:image 是手动裁剪过的成品，内嵌 SVG 本身透明，都不归一。
 *
 * 历史教训：这里曾用「探测 favicon 是否铺满画布」决定 64%+蒙版 / 76%无蒙版，
 * 但扩展页没有 host 权限，faviconV2 响应也没有 ACAO —— fetch 读 MIME 被 CORS 拦、
 * canvas 读像素被 taint 拦，探测恒为 false，所有方形底图都走进了 76%无蒙版那条错路。
 * 可靠判据在扩展约束下拿不到，就别再维护这套假智能：统一蒙版，一刀切干净。
 */
const ICON_MASK = (() => {
    const size = 64;
    const r = size * 0.27;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
        `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();
/**
 * 远程图统一尺寸：实测对比（GitHub / V2EX / Google 三种 favicon）
 *   76% 无蒙版 → 内层方形底与玻璃圆角不同心，两层轮廓明显（旧行为，bug）
 *   76% 有蒙版 → 圆角同心但图偏满，间隙太小
 *   64% 有蒙版 → 透明底图（Google 的 G）偏小
 *   70% 有蒙版 → 方形底与透明底都合适，取此值
 */
const REMOTE_ICON_PCT = 70;
/** 只有远程 <img> 归一；data:image（用户裁剪成品）与内嵌 SVG 一律不改尺寸 */
const isRemoteImg = computed(() => !!imgSrc.value && !logoSrc.value && !isSvgIcon.value);
const iconStyle = computed(() =>
    isRemoteImg.value
        ? { width: `${REMOTE_ICON_PCT}%`, height: `${REMOTE_ICON_PCT}%`, '--icon-mask': ICON_MASK }
        : {}
);

function rebuildSvg(): void {
    const host = slotEl.value;
    if (!host) return;
    if (svgNode.value) {
        svgNode.value.remove();
        svgNode.value = null;
    }
    if (!isSvgIcon.value) return;
    const built = createIconNode(iconText.value);
    if (built instanceof SVGSVGElement) {
        built.classList.add('icon');
        host.appendChild(built);
    }
}

// 换站点（编辑 URL）要重新走一次淡入，否则新图会在旧图的「已就绪」状态里直接硬切
watch(imgSrc, () => {
    imgReady.value = false;
});

function onImgLoad(): void {
    imgReady.value = true;
}

function attachGlassTo(el: HTMLElement): void {
    if (!props.glass) return;
    // dispersion: 0 —— 库默认 clear 预设有 0.15 的色散，在圆角处会把红/蓝通道沿折射方向错开，
    // 小方块上表现为四角一圈彩虹描边。色散是厚玻璃才有的大尺度光学现象，
    // 21% 圆角的小图标没有立体的厚度去承载，直接关掉。
    applyGlass(el, { square: true, radius: 18, specular: 0.5, dispersion: 0 });
}

onMounted(() => {
    rebuildSvg();
    if (slotEl.value) attachGlassTo(slotEl.value);
});

watch(iconText, () => {
    failed.value = false;
    rebuildSvg();
});

onBeforeUnmount(() => {
    if (slotEl.value) releaseGlass(slotEl.value);
});
</script>

<template>
    <div ref="slotEl" class="icon-square">
        <img
            v-if="!isSvgIcon && !failed && imgSrc"
            class="icon"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            :src="imgSrc"
            :style="iconStyle"
            :class="{ 'is-ready': !isRemoteImg || imgReady }"
            @load="onImgLoad"
            @error="failed = true"
        />
        <span v-else-if="!isSvgIcon || failed" class="fallback-icon">{{ fallbackChar }}</span>
    </div>
</template>

<style scoped>
/* 几何与材质：三处共用，尺寸由外部用 --icon-square 覆盖 */
.icon-square {
    width: var(--icon-square, 86px);
    height: var(--icon-square, 86px);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    /* 与库里 square 形状写的圆角一致（18/86 ≈ 21%）：挂玻璃后库会写内联 border-radius，
       不挂玻璃的预览格必须算出同一个值，否则同一个组件会有两种圆角 */
    border-radius: var(--icon-radius, 21%);
    background-color: rgb(var(--spec) / 0.24);
    background-image: linear-gradient(
        160deg,
        rgb(var(--spec) / 0.4) 0%,
        rgb(var(--spec) / 0.06) 100%
    );
    box-shadow:
        inset 0 1px 0 var(--glass-rim),
        inset 0 -1px 0 var(--glass-shade);
    overflow: hidden;
}

/* 图标占方块 62%：系统图标是「图形 + 留白」，不是把方块填满。
   contain 保证任意长宽比的图都完整落在这个方框里，不被裁切。
   远程图由 iconStyle 内联覆盖为 70% 并套 squircle 蒙版（见上方注释）。 */
.icon-square :deep(.icon),
.icon-square img.icon,
.icon-square svg {
    width: 62%;
    height: 62%;
    object-fit: contain;
}

/* 内嵌 SVG 首帧就有，远程图要等一次网络。等的那段时间不留灰底占位，
   加载完成再淡入 —— 一批图标陆续亮起来，比同时闪一圈灰块舒服。 */
.icon-square img.icon:not(.is-ready) {
    opacity: 0;
}

.icon-square img.icon.is-ready {
    opacity: 1;
    transition: opacity 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
    .icon-square img.icon.is-ready {
        transition: none;
    }
}

/* 长宽比统一：站点 favicon 什么形状都有 —— 透明底图形（Google/YouTube）只占画面 67%，
   而铺满画布的实心方块（Bilibili/知乎/GitHub 的 32px 图）会顶着方块边缘，
   同一排看过去有的浮着一小块、有的糊成大色块。
   用户的 data:image 是手动裁剪过的成品，不再归一（只被 contain 约束住大小）。 */
.icon-square img.icon:not([src^='data:']) {
    -webkit-mask-image: var(--icon-mask, none);
    mask-image: var(--icon-mask, none);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
}

.icon-square .fallback-icon {
    width: 56%;
    height: 56%;
    border-radius: 50%;
    background-color: rgb(var(--shadow) / 0.14);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(var(--icon-square, 86px) * 0.28);
    font-weight: 500;
}
</style>
