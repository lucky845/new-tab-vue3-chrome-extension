<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { createIconNode } from '@/src/lib/iconSafe';
import { useQuickAccess } from '@/src/composables/useQuickAccess';
import { quickAccessBridge } from '@/src/composables/useQuickAccessBridge';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { useTip, type TipHandle } from '@/src/composables/useTip';
import { toast } from '@/src/composables/useToast';
import { t } from '@/src/composables/useI18n';

/**
 * 「添加/编辑快捷方式」弹窗。
 *
 * markup 逐字迁移 entrypoints/newtab.html:256-314 的 #add-quick-access-panel；
 * 行为对齐 v1.8.1:js/app.js:1113-1148 的 openAddQuickAccessModal /
 * refreshFolderSelect / openEditQuickAccessModal / validateQuickAccessForm /
 * renderQaIconPreview / saveQuickAccess，以及 :302-340 的 initQaIconHelpTip。
 * 数据层走 useQuickAccess() 模块级单例（与 QuickAccessGrid.vue 共用同一份状态）。
 */

/** v1.8.1:js/app.js:20-21 —— help tip 的文案与链接，逐字保留 */
const QA_ICON_HELP_URL = 'https://www.iconfont.cn/';
const QA_ICON_HELP_MESSAGE = 'qa_icon_help_message';

interface FolderOption {
    index: number;
    name: string;
    items?: unknown[];
}

/* ---------- 自持状态 ---------- */
const dialogOpen = ref(false);
// ref 里存 key，模板渲染时才翻译——切换语言后标题立即跟随
const dialogTitle = ref('qa_dialog_title_add');
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
const helpTitle = ref('qa_icon_help_title');

/** dsh-tip 实例不参与渲染，用普通变量即可 */
let qaIconHelpTip: TipHandle | null = null;

function manager(): ReturnType<typeof useQuickAccess> {
    return useQuickAccess();
}

function refreshGrid(): void {
    // 网格组件把自己的 refreshGrid 注册到 ESM 桥；本组件不直接碰 #quick-access-grid
    quickAccessBridge().refreshGrid?.();
}

/* ---------- 表单校验（v1.8.1:js/app.js:1189-1233） ---------- */
function validateQuickAccessForm(): void {
    const mgr = manager();
    const url = urlDraft.value.trim();
    const name = nameDraft.value.trim();
    const urlCheck = mgr?.validateUrl?.(url) ?? { valid: false, message: 'qa_err_url_invalid' };
    const nameCheck = mgr?.validateName?.(name) ?? {
        valid: false,
        message: 'qa_err_name_length',
    };

    if (url.length === 0) {
        urlInvalid.value = false;
        urlErrorHidden.value = true;
    } else if (urlCheck.valid) {
        urlInvalid.value = false;
        urlErrorHidden.value = true;
    } else {
        urlInvalid.value = true;
        urlErrorText.value = t(urlCheck.message);
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
        nameErrorText.value = t(nameCheck.message);
        nameErrorHidden.value = false;
    }

    saveDisabled.value = !(urlCheck.valid && nameCheck.valid);
}

/* ---------- 图标预览（v1.8.1:js/app.js:1234-1254，走 createIconNode 安全管线） ---------- */
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

/* ---------- 所属文件夹下拉（v1.8.1:js/app.js:1149-1165 refreshFolderSelect） ---------- */
function refreshFolderSelect(preselect = -1): void {
    const mgr = manager();
    const list: FolderOption[] = Array.isArray(mgr?.getFolders?.()) ? mgr.getFolders() : [];
    folders.value = list;
    folderValue.value = list.some(f => f.index === preselect) ? String(preselect) : '-1';
    folderItemHidden.value = list.length === 0;
}

/* ---------- help tip（v1.8.1:js/app.js:1033-1066 initQaIconHelpTip） ---------- */
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
            label: 'qa_icon_help_action',
            title: 'qa_icon_help_action_title',
            onClick: () => window.open(QA_ICON_HELP_URL, '_blank', 'noopener'),
        },
    });
}

/* ---------- 桥方法（签名固定，合并注册不覆盖） ---------- */
function openAdd(preselect = -1): void {
    dialogTitle.value = 'qa_dialog_title_add';
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
    dialogTitle.value = 'qa_dialog_title_edit';
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

/* ---------- 保存（v1.8.1:js/app.js:1255-1302 saveQuickAccess） ---------- */
async function saveQuickAccess(): Promise<void> {
    const mgr = manager();
    let url = urlDraft.value.trim();
    const name = nameDraft.value.trim();
    const icon = iconDraft.value.trim() || null;

    // 保存前必须再校验一次：按钮禁用状态只是 UI 提示
    const urlCheck = mgr?.validateUrl?.(url) ?? { valid: false, message: 'qa_err_url_invalid' };
    const nameCheck = mgr?.validateName?.(name) ?? {
        valid: false,
        message: '名称长度应在 2 到 10 个字符之间。',
    };
    if (!urlCheck.valid || !nameCheck.valid) {
        validateQuickAccessForm();
        // v1.8.1:js/app.js:1275 —— 保存校验失败提示，文案/类型/时长逐字一致
        toast(t(urlCheck.valid ? nameCheck.message : urlCheck.message), 'error', 2200);
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
        labelled-by="qa-panel-title"
        @dismiss="closeDialog"
      >
        <div class="settings-content">
            <button
                id="close-qa-btn"
                class="close-panel-btn"
                type="button"
                :title="t('common_close')"
                :aria-label="t('common_close')"
                @click="closeDialog"
            >
                ✕
            </button>
            <h2 id="qa-panel-title">{{ t(dialogTitle) }}</h2>
            <input type="hidden" id="qa-edit-index" :value="editIndex" />
            <div class="setting-item">
                <label for="qa-url-input">{{ t('qa_url_label') }}</label>
                <input
                    type="text"
                    id="qa-url-input"
                    :placeholder="t('qa_url_placeholder')"
                    v-model="urlDraft"
                    :class="{ invalid: urlInvalid }"
                    @input="validateQuickAccessForm"
                />
                <p id="qa-url-error" :class="['error-message', { 'u-hidden': urlErrorHidden }]">
                    {{ urlErrorText }}
                </p>
            </div>
            <div class="setting-item">
                <label for="qa-name-input">{{ t('qa_name_label') }}</label>
                <input
                    type="text"
                    id="qa-name-input"
                    :placeholder="t('qa_name_placeholder')"
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
                    <label for="qa-icon-input">{{ t('qa_icon_label') }}</label>
                    <button
                        type="button"
                        id="qa-icon-help"
                        class="qa-help-btn"
                        ref="helpBtnEl"
                        :aria-label="t('qa_icon_help_aria')"
                        :title="t(helpTitle)"
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
                    {{ iconAdvancedOpen ? t('qa_icon_collapse') : t('qa_icon_expand') }}
                </button>
                <div v-if="iconAdvancedOpen" class="icon-input-wrapper">
                    <textarea
                        id="qa-icon-input"
                        rows="3"
                        :placeholder="t('qa_icon_placeholder')"
                        v-model="iconDraft"
                        @input="renderQaIconPreview"
                    ></textarea>
                    <div
                        id="qa-icon-preview-container"
                        :class="['icon-preview-container', { 'u-hidden': !iconPreviewVisible }]"
                    >
                        <span class="preview-label">{{ t('qa_icon_preview') }}</span>
                        <div id="qa-icon-preview" class="icon-preview" ref="iconPreviewEl"></div>
                    </div>
                </div>
                <p class="api-key-description">{{ t('qa_icon_hint') }}</p>
            </div>
            <div id="qa-folder-item" :class="['setting-item', { 'u-hidden': folderItemHidden }]">
                <label for="qa-folder-select">{{ t('qa_folder_label') }}</label>
                <select id="qa-folder-select" v-model="folderValue">
                    <option value="-1">{{ t('qa_folder_root') }}</option>
                    <option v-for="f in folders" :key="f.index" :value="String(f.index)">
                        {{ f.name }} ({{ (f.items || []).length }})
                    </option>
                </select>
                <p class="api-key-description">
                    {{ t('qa_folder_hint') }}
                </p>
            </div>
            <div class="settings-actions">
                <button
                    id="save-qa-btn"
                    class="settings-btn"
                    :disabled="saveDisabled"
                    @click="saveQuickAccess"
                >
                    {{ t('qa_save') }}
                </button>
                <button id="cancel-qa-btn" class="settings-btn secondary" @click="closeDialog">
                    {{ t('qa_cancel') }}
                </button>
            </div>
        </div>
    </GlassPanel>
</template>
