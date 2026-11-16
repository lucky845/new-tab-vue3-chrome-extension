/**
 * 快捷访问数据层（模块级单例）。
 * 逐字迁移自 public/legacy-js/modules/quick-access-manager.js：
 * 方法名、分支、文案、返回结构、存储键 quickAccessSites 全部保留；
 * 默认站点改由 ESM 具名导出提供，不再挂全局对象；首装按界面语言选地区组（src/lib/region.ts）。
 * 用 ref 暴露 sites，供 Vue 侧响应式渲染。
 */
import { ref } from 'vue';
import type { Ref } from 'vue';
import { defaultSitesFor } from '@/src/config/defaultSites';
import type { QuickAccessNode } from '@/src/lib/defaultSites';
import { defaultSiteRegion } from '@/src/lib/region';

export type { QuickAccessNode } from '@/src/lib/defaultSites';

/** 首装兜底站点：按浏览器界面语言挑一组（中文界面不放 Google/YouTube/Reddit） */
const cloneDefaults = (): QuickAccessNode[] =>
    defaultSitesFor(defaultSiteRegion()) as unknown as QuickAccessNode[];

/** 规范化 URL：去首尾空白与末尾斜杠，忽略大小写，用于同站点判定。 */
function normalizeSiteUrl(url: string | undefined): string {
    return String(url || '')
        .trim()
        .replace(/\/+$/, '')
        .toLowerCase();
}

/**
 * 根层去重不变量：文件夹解散 / 旧数据迁移会把同名站点回填到根层，
 * 真机截图里出现两个 V2EX 就是这条路径。只在当前列表内比较，
 * 不进入文件夹 items：用户文件夹里放同名站点是合法的。
 */
function dedupeRootSites(list: QuickAccessNode[]): QuickAccessNode[] {
    if (!Array.isArray(list)) return [];
    const seenFolderNames = new Set<string>();
    const seenSiteNames = new Set<string>();
    const seenSiteUrls = new Set<string>();
    const result: QuickAccessNode[] = [];
    for (const node of list) {
        if (!node || typeof node !== 'object') continue;
        const name = String(node.name || '')
            .trim()
            .toLowerCase();
        const url = normalizeSiteUrl(node.url);
        if (node.isFolder) {
            const key = name || url;
            if (key && seenFolderNames.has(key)) continue;
            if (key) seenFolderNames.add(key);
            result.push(node);
            continue;
        }
        // 同名（V2EX / V2EX?tab=tech）或同 URL（末尾斜杠差异）都只留第一个。
        if ((name && seenSiteNames.has(name)) || (url && seenSiteUrls.has(url))) continue;
        if (name) seenSiteNames.add(name);
        if (url) seenSiteUrls.add(url);
        result.push(node);
    }
    return result;
}

// 模块级单例状态：所有 useQuickAccess() 调用共享同一份数据
const sites: Ref<QuickAccessNode[]> = ref<QuickAccessNode[]>([]);
const revision = ref(0);
let fallbackSites: QuickAccessNode[] | null = null;

async function loadSites(): Promise<void> {
    try {
        const result = await chrome.storage.local.get(['quickAccessSites']);
        const raw = (result.quickAccessSites as QuickAccessNode[]) || [];
        const clean = dedupeRootSites(raw);
        sites.value = clean;
        // 旧数据里的重复项必须落盘清除，否则下次启动又回到两行溢出。
        if (clean.length !== raw.length) await saveSites();
    } catch (error) {
        console.error('加载快捷访问失败:', error);
        sites.value = [];
    }
}

async function saveSites(): Promise<void> {
    try {
        // 统一写盘出口：所有新增/编辑/解散/拖拽路径都在这里收敛去重。
        const clean = dedupeRootSites(sites.value as QuickAccessNode[]);
        sites.value = clean;
        // Vue 的 ref 是 Proxy，chrome.storage 的结构化克隆不接受；存一份纯对象快照。
        const snapshot = JSON.parse(JSON.stringify(clean)) as QuickAccessNode[];
        await chrome.storage.local.set({ quickAccessSites: snapshot });
    } catch (error) {
        console.error('保存快捷访问失败:', error);
    }
}

function findDefaultSite(name: string, pool: QuickAccessNode[]): QuickAccessNode | null {
    for (const node of pool) {
        if (!node) continue;
        if (node.isFolder) {
            const hit = (node.items || []).find(item => item.name === name);
            if (hit) return hit;
        } else if (node.name === name) {
            return node;
        }
    }
    return null;
}

// 归一化：只有 1 个成员的文件夹自动解散为单个图标
// 空文件夹（0 项）保持原样：用户刚新建、还没往里放东西，静默删除等于吞数据
async function normalizeFolders(): Promise<boolean> {
    let changed = false;
    for (let i = sites.value.length - 1; i >= 0; i -= 1) {
        const node = sites.value[i];
        if (!node || !node.isFolder) continue;
        const items = Array.isArray(node.items) ? node.items : [];
        if (items.length === 1) {
            sites.value.splice(i, 1, { ...items[0] });
            changed = true;
        }
    }
    if (changed) await saveSites();
    return changed;
}

async function init(): Promise<void> {
    // 每一步都兜住：任何一次 storage 失败都不能让快捷访问整体停摆。
    try {
        await loadSites();
    } catch (error) {
        console.error('[快捷访问] 读取失败，回退默认站点:', (error as Error)?.message || error);
        sites.value = [];
    }

    const isFirstRun = sites.value.length === 0;
    if (isFirstRun) {
        // 首次运行 / 读取失败：都视为空，用默认站点兜底
        try {
            sites.value = cloneDefaults();
            await saveSites();
        } catch (error) {
            console.warn(
                '[快捷访问] 默认站点保存失败（仍会显示）:',
                (error as Error)?.message || error
            );
        }
    }

    if (!isFirstRun) {
        try {
            await normalizeFolders();
        } catch (error) {
            console.warn('[快捷访问] 文件夹归一化失败:', (error as Error)?.message || error);
        }
    }
    // 最后再兜一道：保证至少有一个可渲染的条目列表
    if (!Array.isArray(sites.value)) sites.value = [];
    revision.value += 1;
}

async function addSite(name: string, url: string, icon: string | null): Promise<QuickAccessNode> {
    const newSite: QuickAccessNode = { name, url, icon };
    sites.value.push(newSite);
    await saveSites();
    return newSite;
}

async function editSite(
    index: number,
    name: string,
    url: string,
    icon: string | null
): Promise<QuickAccessNode | null> {
    if (index >= 0 && index < sites.value.length) {
        sites.value[index] = { name, url, icon };
        await saveSites();
        return sites.value[index];
    }
    return null;
}

async function deleteSite(index: number): Promise<QuickAccessNode | null> {
    if (index >= 0 && index < sites.value.length) {
        const deletedSite = sites.value.splice(index, 1)[0];
        await saveSites();
        return deletedSite;
    }
    return null;
}

// ---------- 文件夹 ----------

async function addFolder(name: string): Promise<QuickAccessNode> {
    const folder: QuickAccessNode = { name: name.trim(), isFolder: true, items: [] };
    sites.value.push(folder);
    await saveSites();
    return folder;
}

async function renameFolder(index: number, name: string): Promise<QuickAccessNode | null> {
    const folder = sites.value[index];
    if (!folder || !folder.isFolder) return null;
    folder.name = name.trim();
    await saveSites();
    return folder;
}

async function addSiteToFolder(
    folderIndex: number,
    name: string,
    url: string,
    icon: string | null
): Promise<QuickAccessNode | null> {
    const folder = sites.value[folderIndex];
    if (!folder || !folder.isFolder) return null;
    const item: QuickAccessNode = { name, url, icon: icon || null };
    const items = folder.items || [];
    items.push(item);
    folder.items = items;
    await saveSites();
    return item;
}

/**
 * 拖动合并：把 draggedIndex 的节点并入 targetIndex
 * - 目标是文件夹：追加成员
 * - 目标是站点：新建文件夹（名称自动生成），两者一起放入
 * - 目标是虚拟「新建文件夹」占位（targetIndex === -1）：新建只含 dragged 的文件夹
 * 返回 { folder, name } 或 null
 */
async function mergeIntoFolder(
    draggedIndex: number,
    targetIndex: number,
    folderName: string | null
): Promise<{ folder: QuickAccessNode; name: string } | null> {
    const dragged = getNodeByIndex(draggedIndex);
    if (!dragged) return null;

    if (targetIndex === -1) {
        const name = folderName || suggestFolderName([dragged]);
        const folder: QuickAccessNode = { name, isFolder: true, items: toFolderItems([dragged]) };
        sites.value.splice(draggedIndex, 1);
        sites.value.push(folder);
        await saveSites();
        return { folder, name };
    }

    const target = getNodeByIndex(targetIndex);
    if (!target || targetIndex === draggedIndex) return null;

    if (target.isFolder) {
        target.items = [...(target.items || []), ...toFolderItems([dragged])];
        sites.value.splice(draggedIndex, 1);
        await saveSites();
        return { folder: target, name: target.name };
    }

    // 站点 + 站点 → 新建文件夹，位置落在被拖入方
    const name = folderName || suggestFolderName([target, dragged]);
    const insertAt = Math.min(draggedIndex, targetIndex);
    const members = toFolderItems([target, dragged]);
    const folder: QuickAccessNode = { name, isFolder: true, items: members };
    const kept = sites.value.filter((_, i) => i !== draggedIndex && i !== targetIndex);
    const folderPos = Math.min(insertAt, kept.length);
    kept.splice(folderPos, 0, folder);
    sites.value = kept;
    await saveSites();
    return { folder, name };
}

// 索引取节点（不存在的索引返回 null）
function getNodeByIndex(index: number): QuickAccessNode | null {
    if (!Number.isInteger(index) || index < 0 || index >= sites.value.length) return null;
    return sites.value[index];
}

// 节点 → 文件夹成员数组（文件夹会被展开）
function toFolderItems(nodes: QuickAccessNode[]): QuickAccessNode[] {
    const out: QuickAccessNode[] = [];
    nodes.filter(Boolean).forEach(node => {
        if (node.isFolder) {
            out.push(...(node.items || []).map(item => ({ ...item })));
        } else {
            out.push({ name: node.name, url: node.url, icon: node.icon || null });
        }
    });
    return out;
}

// 依据站点域名给出建议文件夹名
function suggestFolderName(nodes: QuickAccessNode[]): string {
    const hosts = toFolderItems(nodes)
        .map(item => {
            try {
                return new URL(item.url || '').hostname.replace(/^www\./, '');
            } catch {
                return '';
            }
        })
        .filter(Boolean);
    // 逐段从末尾比较，取公共后缀（a.github.com + b.github.com → github.com）
    const commonSuffix = (left: string, right: string): string => {
        const a = left.split('.').reverse();
        const b = right.split('.').reverse();
        const out: string[] = [];
        for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
            if (a[i] !== b[i]) break;
            out.push(a[i]);
        }
        return out.reverse().join('.');
    };

    let common = hosts[0] || '';
    for (let i = 1; i < hosts.length; i += 1) {
        common = commonSuffix(common, hosts[i]);
        if (!common.includes('.')) break;
    }

    if (common && common.includes('.')) {
        // 去掉顶级域，取主体名（github.com → github）
        const label = common.split('.')[0];
        if (label && !['www', 'com', 'cn'].includes(label.toLowerCase())) {
            return label.slice(0, 10);
        }
    }
    return '文件夹';
}

// 把文件夹内某一项移回根列表（不删除数据）；成员不足 2 个时文件夹自动解散
async function moveFromFolderToRoot(
    folderIndex: number,
    itemIndex: number
): Promise<QuickAccessNode | null> {
    const folder = sites.value[folderIndex];
    if (!folder || !folder.isFolder) return null;
    const [item] = (folder.items || []).splice(itemIndex, 1);
    if (!item) return null;
    const stillHasMembers = (folder.items || []).length >= 2;
    if (stillHasMembers) {
        sites.value.push(item);
    } else {
        // 文件夹将解散：把剩余成员与本项一起放回根列表
        const rest = folder.items || [];
        sites.value.splice(folderIndex, 1, ...[...rest, item].map(x => ({ ...x })));
    }
    await saveSites();
    await normalizeFolders();
    return item;
}

// 文件夹内排序（拖拽重排后回写）
async function reorderFolderItems(folderIndex: number, orderedNames: string[]): Promise<boolean> {
    const folder = sites.value[folderIndex];
    if (!folder || !folder.isFolder) return false;
    const map = new Map<string, QuickAccessNode>(
        (folder.items || []).map(item => [item.name, item])
    );
    const next: QuickAccessNode[] = [];
    (orderedNames || []).forEach(name => {
        const item = map.get(name);
        if (item) {
            next.push(item);
            map.delete(name);
        }
    });
    map.forEach(item => next.push(item));
    folder.items = next;
    await saveSites();
    return true;
}

// 解散文件夹：内部站点按序回填到根列表，随后删除该文件夹
async function dissolveFolder(index: number): Promise<QuickAccessNode[] | null> {
    const folder = sites.value[index];
    if (!folder || !folder.isFolder) return null;
    const items = (folder.items || []).map(item => ({ ...item }));
    sites.value.splice(index, 1, ...items);
    await saveSites();
    return items;
}

// 把根列表中的站点移入文件夹
async function moveSiteToFolder(siteIndex: number, folderIndex: number): Promise<boolean | null> {
    const site = sites.value[siteIndex];
    const folder = sites.value[folderIndex];
    if (!site || site.isFolder || !folder || !folder.isFolder) return null;
    const items = folder.items || [];
    items.push({ name: site.name, url: site.url, icon: site.icon || null });
    folder.items = items;
    sites.value.splice(siteIndex, 1);
    await saveSites();
    return true;
}

// 获取所有文件夹（附带原索引，便于定位）
function getFolders(): Array<QuickAccessNode & { index: number }> {
    return sites.value.map((site, index) => ({ ...site, index })).filter(site => site.isFolder);
}

// 获取所有快捷访问项目
function getSites(): QuickAccessNode[] {
    // 兜底：正常路径下 sites 一定已被 init() 填好；但 storage 卡死/超时时
    // init 可能没能完成赋值，这里返回默认站点而不是空数组。
    if (!Array.isArray(sites.value) || sites.value.length === 0) {
        if (!fallbackSites) {
            fallbackSites = cloneDefaults();
        }
        return fallbackSites;
    }
    return sites.value;
}

// 覆写全部项目（拖拽排序等整表变更场景；setItems 前必须先改内存数据）
function setSites(newSites: QuickAccessNode[]): void {
    sites.value = dedupeRootSites(
        Array.isArray(newSites) ? newSites : (sites.value as QuickAccessNode[])
    );
}

// 渲染快捷访问：Vue 侧靠 revision 触发重绘
function renderQuickAccess(): void {
    revision.value += 1;
}

// 验证URL格式（与设置面板 UI 同源规则，返回 {valid, message}）
function validateUrl(url: string): { valid: boolean; message: string } {
    if (!url || !url.trim()) {
        return { valid: false, message: '请输入有效的网址。' };
    }
    const urlPattern =
        /^(https?:\/\/)?((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|((\d{1,3}\.){3}\d{1,3}))(:\d+)?(\/[-a-z\d%_.~+]*)*(\?.*)?(#[-a-z\d_]*)?$/i;
    return {
        valid: urlPattern.test(url.trim()),
        message: '请输入有效的网址。',
    };
}

// 验证名称（2-10 字符，与设置面板 UI 同源规则）
function validateName(name: string): { valid: boolean; message: string } {
    const len = (name || '').trim().length;
    return {
        valid: len >= 2 && len <= 10,
        message: '名称长度应在 2 到 10 个字符之间。',
    };
}

export function useQuickAccess() {
    return {
        sites,
        revision,
        init,
        loadSites,
        saveSites,
        getSites,
        setSites,
        renderQuickAccess,
        findDefaultSite,
        normalizeFolders,
        addSite,
        editSite,
        deleteSite,
        addFolder,
        renameFolder,
        addSiteToFolder,
        mergeIntoFolder,
        getNodeByIndex,
        toFolderItems,
        suggestFolderName,
        moveFromFolderToRoot,
        reorderFolderItems,
        dissolveFolder,
        moveSiteToFolder,
        getFolders,
        validateUrl,
        validateName,
    };
}
