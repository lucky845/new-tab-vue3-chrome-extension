/// <reference types="chrome" />
/**
 * 左右翼四张迷你卡的显隐设置。
 *
 * 问题：四张卡是 fixed 定位的「常驻占位」，中间内容为了让出翼宽，在 700–980px
 * 被媒体查询压到 3 列、1180px 压到 4 列 —— 用户什么都没做，列数却在跳。
 * 解法：每张卡一个三态开关，默认 auto（有数据才出现），全隐时整翼退场，
 * 中间内容收回被让出的宽度（见 app.css 的 body[data-wings] 规则）。
 *
 * 存储键 'sideCardModes' 是本版新增，不覆盖任何 legacy 键。
 */
import { computed, ref, watchEffect, type ComputedRef, type Ref } from 'vue';
import { useStored } from '@/src/lib/storage';
import { useNotes } from '@/src/composables/useNotes';
import { usePomodoro } from '@/src/composables/usePomodoro';
import { useTodo } from '@/src/composables/useTodo';

export type SideCardId = 'todo' | 'pomodoro' | 'notes' | 'tools';
export type SideCardMode = 'auto' | 'always' | 'never';
export type SideCardModes = Record<SideCardId, SideCardMode>;

export const SIDE_CARD_STORAGE_KEY = 'sideCardModes';

export const SIDE_CARD_LABELS: Array<{ id: SideCardId; label: string; hint: string }> = [
    { id: 'todo', label: '待办', hint: '有未完成待办时出现' },
    { id: 'pomodoro', label: '番茄钟', hint: '今天有专注记录或正在计时时出现' },
    { id: 'notes', label: '便签', hint: '有便签时出现' },
    { id: 'tools', label: '小工具', hint: '小工具是固定内容，默认常驻' },
];

const DEFAULT_MODES: SideCardModes = {
    todo: 'auto',
    pomodoro: 'auto',
    notes: 'auto',
    tools: 'always',
};

const MODE_VALUES: SideCardMode[] = ['auto', 'always', 'never'];

/** 只接受三态白名单值；存储里出现脏值（旧版本、手改、备份）一律退回 auto。 */
function sanitize(raw: unknown): SideCardModes {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<SideCardId, unknown>>;
    const next = { ...DEFAULT_MODES };
    for (const { id } of SIDE_CARD_LABELS) {
        const value = source[id];
        if (typeof value === 'string' && (MODE_VALUES as string[]).includes(value)) {
            next[id] = value as SideCardMode;
        }
    }
    return next;
}

export type WingsState = 'none' | 'left' | 'right' | 'both';

export interface SideCardsApi {
    modes: Ref<SideCardModes>;
    visible: (id: SideCardId) => boolean;
    setMode: (id: SideCardId, mode: SideCardMode) => void;
    /** 当前有内容出现的卡片（受 modes 影响），App.vue 用它给 body 打 data-wings */
    wings: ComputedRef<WingsState>;
}

let api: SideCardsApi | null = null;

export function useSideCards(): SideCardsApi {
    if (api) return api;

    const modes = useStored<SideCardModes>(SIDE_CARD_STORAGE_KEY, { ...DEFAULT_MODES }, {
        load: sanitize,
    });

    /**
     * 总开关仍是设置面板里既有的 showSideWidgets（存在 settings 共享键里、已进备份 schema）。
     * 这里只读它、不改它：总开关关掉时四张卡一律不出现，避免两个开关互相打架。
     */
    const masterEnabled = ref(true);
    void chrome.storage.local.get(['settings']).then((result) => {
        const saved = (result.settings || {}) as { showSideWidgets?: unknown };
        masterEnabled.value = saved.showSideWidgets !== false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.settings) return;
        const next = (changes.settings.newValue || {}) as { showSideWidgets?: unknown };
        masterEnabled.value = next.showSideWidgets !== false;
    });

    const todo = useTodo();
    const notes = useNotes();
    const pomodoro = usePomodoro();

    /** 「有数据」的判定：只读已有状态，不为了显示卡片去造数据。 */
    const hasContent: Record<SideCardId, () => boolean> = {
        todo: () => todo.todos.value.some((item) => !item.done),
        pomodoro: () => pomodoro.isRunning.value || pomodoro.stats.value.completedToday > 0,
        notes: () => notes.notes.value.length > 0,
        // 小工具卡是固定内容（时间戳 / JSON / Base64 …），不存在「空」的状态
        tools: () => true,
    };

    const visible = (id: SideCardId): boolean => {
        if (!masterEnabled.value) return false;
        const mode = modes.value[id] ?? DEFAULT_MODES[id];
        if (mode === 'never') return false;
        if (mode === 'always') return true;
        return hasContent[id]();
    };

    const wings = computed<WingsState>(() => {
        const left = visible('todo') || visible('pomodoro');
        const right = visible('notes') || visible('tools');
        if (left && right) return 'both';
        if (left) return 'left';
        if (right) return 'right';
        return 'none';
    });

    const setMode = (id: SideCardId, mode: SideCardMode): void => {
        modes.value = { ...modes.value, [id]: mode };
    };

    api = { modes, visible, setMode, wings };
    return api;
}

/**
 * 把当前翼状态写到 <body data-wings>，CSS 据此收回被让出的宽度。
 * 只在 App.vue 里挂一次；effect 自带清理，不额外留监听。
 */
export function bindWingsAttribute(): void {
    const { wings } = useSideCards();
    watchEffect(() => {
        if (typeof document === 'undefined') return;
        document.body.dataset.wings = wings.value;
    });
}
