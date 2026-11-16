<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { createIconNode } from '@/src/lib/iconSafe';
import { useQuickAccess } from '@/src/composables/useQuickAccess';
import { quickAccessBridge } from '@/src/composables/useQuickAccessBridge';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { useTip, type TipHandle } from '@/src/composables/useTip';
import { toast } from '@/src/composables/useToast';

/**
 * 「添加/编辑快捷方式」弹窗。
 *
 * markup 逐字迁移 entrypoints/newtab.html:256-314 的 #add-quick-access-panel；
 * 行为对齐 public/legacy-js/app.js:1680-1872 的 openAddQuickAccessModal /
 * refreshFolderSelect / openEditQuickAccessModal / validateQuickAccessForm /
 * renderQaIconPreview / saveQuickAccess，以及 :302-340 的 initQaIconHelpTip。
 * 数据层走 useQuickAccess() 模块级单例（与 QuickAccessGrid.vue 共用同一份状态）。
 */

/** app.js:20-21 —— help tip 的文案与链接，逐字保留 */
const QA_ICON_HELP_URL = 'https://www.iconfont.cn/';
const QA_ICON_HELP_MESSAGE = '推荐前往 iconfont.cn 获取SVG代码。';

interface FolderOption {
    index: number;
    name: string;
    items?: unknown[];
}

/* ---------- 自持状态 ---------- */
const dialogOpen = ref(false);
const dialogTitle = ref('添加快捷方式');
const editIndex = ref(-1);

const urlDraft = ref('');
const nameDraft = ref('');
const iconDraft = ref('');
/** 图标输入默认折叠：留空自动抓站点图标，只有想换成品牌图的人才需要展开 */
const iconAdvancedOpen = ref(false);
const folderValue = ref('-1');
const folders = ref<FolderOption[]>([]);
const folderItemHidden = ref(false);

const urlInvalid = ref(false);
const nameInvalid = ref(false);
const urlErrorText = ref('');
const nameErrorText = ref('');
const urlErrorHidden = ref(true);
const nameErrorHidden = ref(true);
const saveDisabled = ref(true);

const iconPreviewVisible = ref(false);
const iconPreviewEl = ref<HTMLElement | null>(null);
const helpBtnEl = ref<HTMLButtonElement | null>(null);
const helpTitle = ref('关于自定义图标');

/** dsh-tip 实例不参与渲染，用普通变量即可 */
let qaIconHelpTip: TipHandle | null = null;

function manager(): ReturnType<typeof useQuickAccess> {
    return useQuickAccess();
}

function refreshGrid(): void {
    // 网格组件把自己的 refreshGrid 注册到 ESM 桥；本组件不直接碰 #quick-access-grid
    quickAccessBridge().refreshGrid?.();
}

/* ---------- 表单校验（app.js:1759-1801） ---------- */
function validateQuickAccessForm(): void {
    const mgr = manager();
    const url = urlDraft.value.trim();
    const name = nameDraft.value.trim();
    const urlCheck = mgr?.validateUrl?.(url) ?? { valid: false, message: '请输入有效的网址。' };
    const nameCheck = mgr?.validateName?.(name) ?? {
        valid: false,
        message: '名称长度应在 2 到 10 个字符之间。',
    };

    if (url.length === 0) {
        urlInvalid.value = false;
        urlErrorHidden.value = true;
    } else if (urlCheck.valid) {
        urlInvalid.value = false;
        urlErrorHidden.value = true;
    } else {
        urlInvalid.value = true;
        urlErrorText.value = urlCheck.message;
        urlErrorHidden.value = false;
    }

    if (name.length === 0) {
        nameInvalid.value = false;
        nameErrorHidden.value = true;
    } else if (nameCheck.valid) {
        nameInvalid.value = false;
        nameErrorHidden.value = true;
    } else {
        nameInvalid.value = true;
        nameErrorText.value = nameCheck.message;
        nameErrorHidden.value = false;
    }

    saveDisabled.value = !(urlCheck.valid && nameCheck.valid);
}

/* ---------- 图标预览（app.js:1805-1823，走 createIconNode 安全管线） ---------- */
function renderQaIconPreview(): void {
    const host = iconPreviewEl.value;
    if (!host) {
        iconPreviewVisible.value = false;
        return;
    }
    const input = iconDraft.value.trim();
    host.replaceChildren();
    const node = createIconNode(input);
    if (node) {
        host.appendChild(node);
        iconPreviewVisible.value = true;
    } else {
        // IconSafe 缺失或返回 null 时回退：收起预览容器
        iconPreviewVisible.value = false;
    }
}

/* ---------- 所属文件夹下拉（app.js:1717-1731） ---------- */
function refreshFolderSelect(preselect = -1): void {
    const mgr = manager();
    const list: FolderOption[] = Array.isArray(mgr?.getFolders?.()) ? mgr.getFolders() : [];
    folders.value = list;
    folderValue.value = list.some(f => f.index === preselect) ? String(preselect) : '-1';
    folderItemHidden.value = list.length === 0;
}

/* ---------- help tip（app.js:302-340） ---------- */
function dismissQaIconHelpTip(): void {
    const tip = qaIconHelpTip;
    qaIconHelpTip = null;
    if (tip && !tip.closed && typeof tip.close === 'function') tip.close();
}

function onIconHelpClick(): void {
    const anchor = helpBtnEl.value;
    if (!anchor) return;
    // 再点一次收起（按钮本身就是开关，避免提示只能靠关闭按钮收敛）
    if (qaIconHelpTip && !qaIconHelpTip.closed) {
        dismissQaIconHelpTip();
        return;
    }
    qaIconHelpTip = useTip().attach(anchor, {
        type: 'info',
        key: 'qa-icon-help',
        placement: 'auto',
        duration: 0,
        closable: true,
        message: QA_ICON_HELP_MESSAGE,
        action: {
            label: '打开 iconfont',
            title: '在新标签页打开 https://www.iconfont.cn/',
            onClick: () => window.open(QA_ICON_HELP_URL, '_blank', 'noopener'),
        },
    });
}

/* ---------- 桥方法（签名固定，合并注册不覆盖） ---------- */
function openAdd(preselect = -1): void {
    dialogTitle.value = '添加快捷方式';
    editIndex.value = -1;
    urlDraft.value = '';
    nameDraft.value = '';
    iconDraft.value = '';
    iconAdvancedOpen.value = false;
    iconPreviewVisible.value = false;
    iconPreviewEl.value?.replaceChildren();
    urlInvalid.value = false;
    nameInvalid.value = false;
    urlErrorHidden.value = true;
    nameErrorHidden.value = true;
    urlErrorText.value = '';
    nameErrorText.value = '';
    refreshFolderSelect(preselect);
    validateQuickAccessForm();
    dialogOpen.value = true;
}

function openEdit(index: number): void {
    const mgr = manager();
    const site = mgr?.getSites?.()[index];
    if (!site) return;
    dialogTitle.value = '编辑快捷方式';
    editIndex.value = index;
    urlDraft.value = site.url ?? '';
    nameDraft.value = site.name ?? '';
    iconDraft.value = site.icon || '';
    // 编辑已有自定义图标的站点时直接展开，否则用户看不到自己设的图标
    iconAdvancedOpen.value = Boolean(site.icon);
    renderQaIconPreview(); // 对应 legacy 的 qaIconInput.dispatchEvent(new Event('input'))
    validateQuickAccessForm();
    dialogOpen.value = true;
}

function closeDialog(): void {
    dialogOpen.value = false;
    dismissQaIconHelpTip();
    refreshGrid();
}

/* ---------- 保存（app.js:1827-1872） ---------- */
async function saveQuickAccess(): Promise<void> {
    const mgr = manager();
    let url = urlDraft.value.trim();
    const name = nameDraft.value.trim();
    const icon = iconDraft.value.trim() || null;

    // 保存前必须再校验一次：按钮禁用状态只是 UI 提示
    const urlCheck = mgr?.validateUrl?.(url) ?? { valid: false, message: '请输入有效的网址。' };
    const nameCheck = mgr?.validateName?.(name) ?? {
        valid: false,
        message: '名称长度应在 2 到 10 个字符之间。',
    };
    if (!urlCheck.valid || !nameCheck.valid) {
        validateQuickAccessForm();
        // app.js:1847 —— 保存校验失败提示，文案/类型/时长逐字一致
        toast(urlCheck.valid ? nameCheck.message : urlCheck.message, 'error', 2200);
        return;
    }
    saveDisabled.value = false;

    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }

    if (editIndex.value > -1) {
        await mgr?.editSite?.(editIndex.value, name, url, icon);
    } else {
        const folderIndex = parseInt(folderValue.value, 10);
        if (folderIndex >= 0) {
            await mgr?.addSiteToFolder?.(folderIndex, name, url, icon);
        } else {
            await mgr?.addSite?.(name, url, icon);
        }
    }

    // legacy 此处是 renderQuickAccess() + 收面板 + dismissQaIconHelpTip()；
    // 组件不碰 #quick-access-grid，统一交给桥的 refreshGrid（不存在则忽略）。
    closeDialog();
}

onMounted(() => {
    Object.assign(quickAccessBridge(), { openAdd, openEdit, closeDialog });
});

onUnmounted(() => {
    dismissQaIconHelpTip();
    const bridge = quickAccessBridge();
    if (bridge.openAdd === openAdd) delete bridge.openAdd;
    if (bridge.openEdit === openEdit) delete bridge.openEdit;
    if (bridge.closeDialog === closeDialog) delete bridge.closeDialog;
});
</script>

<template>
    <GlassPanel
        panelId="add-qa"
        :open="dialogOpen"
        variant="settings"
        elementId="add-quick-access-panel"
        @dismiss="closeDialog"
      >
        <div class="settings-content">
            <button
                id="close-qa-btn"
                class="close-panel-btn"
                type="button"
                title="关闭"
                @click="closeDialog"
            >
                ✕
            </button>
            <h2 id="qa-panel-title">{{ dialogTitle }}</h2>
            <input type="hidden" id="qa-edit-index" :value="editIndex" />
            <div class="setting-item">
                <label for="qa-url-input">链接地址 (URL)</label>
                <input
                    type="text"
                    id="qa-url-input"
                    placeholder="例如: https://www.baidu.com"
                    v-model="urlDraft"
                    :class="{ invalid: urlInvalid }"
                    @input="validateQuickAccessForm"
                />
                <p id="qa-url-error" :class="['error-message', { 'u-hidden': urlErrorHidden }]">
                    {{ urlErrorText }}
                </p>
            </div>
            <div class="setting-item">
                <label for="qa-name-input">标签名称</label>
                <input
                    type="text"
                    id="qa-name-input"
                    placeholder="例如: Baidu"
                    v-model="nameDraft"
                    :class="{ invalid: nameInvalid }"
                    @input="validateQuickAccessForm"
                />
                <p id="qa-name-error" :class="['error-message', { 'u-hidden': nameErrorHidden }]">
                    {{ nameErrorText }}
                </p>
            </div>
            <div class="setting-item">
                <div class="label-with-tooltip">
                    <label for="qa-icon-input">换个图标（选填）</label>
                    <button
                        type="button"
                        id="qa-icon-help"
                        class="qa-help-btn"
                        ref="helpBtnEl"
                        aria-label="关于自定义图标的说明"
                        :title="helpTitle"
                        @click="onIconHelpClick"
                    >
                        i
                    </button>
                </div>
                <!-- 多数用户根本不需要自定义图标：默认折叠，留空就自动抓站点图标 -->
                <button
                    type="button"
                    class="qa-advanced-toggle"
                    :aria-expanded="iconAdvancedOpen"
                    @click="iconAdvancedOpen = !iconAdvancedOpen"
                >
                    {{ iconAdvancedOpen ? '收起图标设置' : '想换个图标？点这里' }}
                </button>
                <div v-if="iconAdvancedOpen" class="icon-input-wrapper">
                    <textarea
                        id="qa-icon-input"
                        rows="3"
                        placeholder="粘贴图片 URL 或 SVG 代码"
                        v-model="iconDraft"
                        @input="renderQaIconPreview"
                    ></textarea>
                    <div
                        id="qa-icon-preview-container"
                        :class="['icon-preview-container', { 'u-hidden': !iconPreviewVisible }]"
                    >
                        <span class="preview-label">预览:</span>
                        <div id="qa-icon-preview" class="icon-preview" ref="iconPreviewEl"></div>
                    </div>
                </div>
                <p class="api-key-description">不用管这一项：留空会自动抓网站图标。</p>
            </div>
            <div id="qa-folder-item" :class="['setting-item', { 'u-hidden': folderItemHidden }]">
                <label for="qa-folder-select">所属文件夹</label>
                <select id="qa-folder-select" v-model="folderValue">
                    <option value="-1">根目录（不放入文件夹）</option>
                    <option v-for="f in folders" :key="f.index" :value="String(f.index)">
                        {{ f.name }}（{{ (f.items || []).length }}）
                    </option>
                </select>
                <p class="api-key-description">
                    也可以保存后在快捷方式上右键，选择「移入文件夹」或「新建文件夹」。
                </p>
            </div>
            <div class="settings-actions">
                <button
                    id="save-qa-btn"
                    class="settings-btn"
                    :disabled="saveDisabled"
                    @click="saveQuickAccess"
                >
                    保存
                </button>
                <button id="cancel-qa-btn" class="settings-btn secondary" @click="closeDialog">
                    取消
                </button>
            </div>
        </div>
    </GlassPanel>
</template>
