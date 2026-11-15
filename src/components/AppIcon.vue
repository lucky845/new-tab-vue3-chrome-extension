<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createIconNode, firstCharOf, isDataImage, siteIconUrl } from '@/src/lib/iconSafe';
import { applyGlass, releaseGlass } from '@/src/lib/glass';
import { isExtensionOrigin, resolveFetchUrl } from '@/src/lib/http';

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
 *   3. favicon 服务
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
    { name: '', url: '', icon: null, glass: true, upper: true },
);

const slotEl = ref<HTMLElement | null>(null);
/** 图片加载失败才切的兜底；正常路径由 <img> 自己渲染 */
const failed = ref(false);
const svgNode = shallowRef<SVGSVGElement | null>(null);
/** 图片本身的自然宽度；0 = 还没解析完或加载失败 */
/** 这张远程图是否「铺满画布」（四边 3px 都有不透明像素）——实测判据，不靠尺寸猜 */
const fullBleed = ref(false);

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
 *   · 透明底只占画面 67% 的图形（Google 三色 G、YouTube 圆角矩形）
 *   · 铺满整张画布的实心方块（Bilibili 粉色 #e8a5b8、知乎蓝色 #51a1ff、GitHub 32px 白底图标）
 * 同一个 62% 的盒子里，前者看着「小一号浮在中间」，后者顶到玻璃边缘像贴了一块色卡。
 *
 * 处理办法不是裁切（圆角方块裁成圆形会把字标切掉），而是把「画面」本身归一：
 * 所有远程图标统一用同一个浏览器窗口式的 squircle 蒙版（圆角 27%）收边。
 * 透明底的图形蒙版看不见，实心方块则被收成与整套图标同一个圆角语言。
 * 蒙版只作用在远程图；用户的 data:image 是手动裁剪过的成品，不再归一。
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
 * 实证（curl 直接取 Google favicon 服务）：
 *   google.com   128px 透明占比 67%，边线只有 1% 有像素 —— 图形本来就小
 *   youtube.com  128px 透明占比 67%                         —— 同上
 *   github.com    32px 铺满，白底圆盘                        —— 图本身分辨率就低
 *   bilibili.com 128px 100% 不透明，粉色铺满                —— 没有留白
 *   zhihu.com    128px 100% 不透明，蓝色铺满                —— 没有留白
 * 前两者「小」，后三者「满」，同一个 62% 的盒子放不下两种尺度。
 *
 * 归一规则：小图放大到 76%，铺满的图收到 64% 并加圆角蒙版（两者实测可见面积都 ≈38%）。
 *   · 放大透明底图形只是在玻璃上多铺一层自己的底色，不丢形状；
 *   · 铺满的实心块缩小 + squircle 蒙版后，视觉面积与 Google/YouTube 对齐，
 *     而且不会顶到玻璃边缘变成一块色卡。
 */
const BIG_ICON_PCT = 76;
/**
 * 64%：按真实图形实测可见面积定的值 —— 透明底图（Google / YouTube）在 76% 下约 39%，
 * 铺满图在 56% 只有 29%（明显偏小），64% 是 38%，两者对齐。
 * 只降尺寸不降留白，是因为铺满图收得再小也还是一块实心色卡，靠圆角蒙版切出形状才成立。
 */
const FULL_ICON_PCT = 64;
/** 只有远程 <img> 能做像素测量；data:image（用户裁剪成品）与内嵌 SVG 一律不改尺寸 */
const isRemoteImg = computed(() => !!imgSrc.value && !logoSrc.value && !isSvgIcon.value);
const iconStyle = computed(() => {
    if (fullBleed.value) {
        return { width: `${FULL_ICON_PCT}%`, height: `${FULL_ICON_PCT}%`, '--icon-mask': ICON_MASK };
    }
    return { width: `${BIG_ICON_PCT}%`, height: `${BIG_ICON_PCT}%` };
});

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
        // 同一处：记录 SVG 的自带尺寸，供归一化判断用
        host.appendChild(built);
    }
}

/**
 * 判断这张远程图是不是「铺满画布」：四边各取 3px 宽的带，只要有足够比例的不透明像素，
 * 就说明图本身没有留白（Bilibili / 知乎 / GitHub 这类实心方块）。
 *
 * 为什么要实测而不是看尺寸：favicon 服务对不同站点给出的分辨率不同（32 / 64 / 128），
 * 尺寸与「有没有留白」没有关系；只有像素才能回答这个问题。
 * 跨域图会污染 canvas，所以先 fetch 成 blob 再从同源 blob: URL 画进去；
 * 服务不支持 CORS 时 fetch 直接失败，就保持默认的「有留白」处理，不抛错。
 */
function onImgLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!isRemoteImg.value) return;
    measureFullBleed(img)
        .then((bleed) => {
            fullBleed.value = bleed;
        })
        .catch(() => {
            /* 拿不到像素就按「有留白」处理 */
        });
}

async function measureFullBleed(img: HTMLImageElement): Promise<boolean> {
    // 先试 CORS：拿得到就是干净像素；拿不到（没开 CORS 的服务）退回缓存里那张
    // 带凭证的图（favicon 不走反代时是 <img> 自己加载的，缓存里可能已经有一份），
    // 再不行就再用一个 cors 模式的请求兜底 —— 全程失败只返回 false，不抛给调用方。
    let blob: Blob | null = null;
    const src = img.currentSrc || img.src;
    // 开发预览时 dev 反代把同一张图映射成同源路径，不享受 CORS 的正是那条
    try {
        const response = await fetch(resolveFetchUrl(src));
        if (response.ok) blob = await response.blob();
    } catch {
        /* 拿不到就放弃 */
    }
    // 扩展里这条其实不会触发（host_permissions 已放行 www.google.com 与 *://*/*）；
    // 留着是为了「预览页 + 没开反代」时仍然只是安静回落，不刷控制台错误。
    if (!blob && isExtensionOrigin()) blob = await fetchViaDom(img);
    if (!blob) return false;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0);
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    const band = 3;
    let edgePx = 0;
    let edgeOn = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (x >= band && x < width - band && y >= band && y < height - band) continue;
            edgePx++;
            if (data[(y * width + x) * 4 + 3] > 16) edgeOn++;
        }
    }
    bitmap.close();
    return edgePx > 0 && edgeOn / edgePx >= 0.9;
}

/**
 * 兜底取图：把图再走一遍浏览器缓存读成 data URL。
 * <img> 已经在页面上显示出来了，说明字节一定在缓存里，不重复发网络请求。
 * 没有缓存命中时读图会失败（受同一套 CORS 限制），这时返回 null，由调用方回落。
 */
function fetchViaDom(img: HTMLImageElement): Promise<Blob | null> {
    return new Promise((resolve) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', img.currentSrc || img.src);
            xhr.responseType = 'blob';
            xhr.onload = () => resolve(xhr.status === 200 ? (xhr.response as Blob) : null);
            xhr.onerror = () => resolve(null);
            xhr.send();
        } catch {
            resolve(null);
        }
    });
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
    fullBleed.value = false;
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
    background-image: linear-gradient(160deg, rgb(var(--spec) / 0.4) 0%, rgb(var(--spec) / 0.06) 100%);
    box-shadow:
        inset 0 1px 0 var(--glass-rim),
        inset 0 -1px 0 var(--glass-shade);
    overflow: hidden;
}

/* 图标占方块 62%：系统图标是「图形 + 留白」，不是把方块填满。
   contain 保证任意长宽比的图都完整落在这个方框里，不被裁切。 */
.icon-square :deep(.icon),
.icon-square img.icon,
.icon-square svg {
    width: 62%;
    height: 62%;
    object-fit: contain;
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
