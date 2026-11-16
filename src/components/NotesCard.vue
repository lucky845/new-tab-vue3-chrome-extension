<script setup lang="ts">
/**
 * 主页右翼便签迷你卡 —— markup 逐字来自 entrypoints/newtab.html:208-214（#side-card-notes）。
 *
 * legacy 映射（public/legacy-js/app.js）：
 * - renderNotesCard（1122-1132）：全量 getNotes() + 徽标 getNotes().length、空态 '还没有便签'
 * - renderNotesInto（1044-1120，覆盖 966-1042 的同名定义）：note-card 结构 + 500ms 防抖自动保存
 * - 展开按钮（1368）：panelBtn.click() → usePanels().toggle('notes')
 *
 * 与 NotesPanel 共享 useNotes 单例；便签列表从不挂 Sortable。
 */
import { setPanelOriginFromEvent, usePanels } from '@/src/composables/usePanels';
import { useNotes, formatNoteTime, type Note } from '@/src/composables/useNotes';
import { toast } from '@/src/composables/useToast';
import { useSideCards } from '@/src/composables/useSideCards';

const { visible } = useSideCards();

const { toggle } = usePanels();

/** 记录展开原点后开合：面板卡片从被点的这颗按钮长出来（见 app.css 的 --panel-origin）。 */
function openPanel(id: Parameters<typeof toggle>[0], ev: MouseEvent): void {
  setPanelOriginFromEvent(id, ev);
  toggle(id);
}
const { sortedNotes, stats, updateNote, togglePin, removeNote } = useNotes();

/** legacy AppIcons（public/legacy-js/app.js 第 6、8 行逐字拷贝，视觉零漂移） */
const ICONS = {
  pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
} as const;

// —— textarea 模板 ref：对应 legacy 的 notesList.querySelector(li[data-id] textarea) ——
const textareaRefs = new Map<string, HTMLTextAreaElement>();
function setTextareaRef(id: string, el: unknown): void {
  const ta = el as HTMLTextAreaElement | null;
  if (ta) textareaRefs.set(id, ta);
  else textareaRefs.delete(id);
}

// —— 500ms 防抖自动保存（等价 app.js noteSaveTimers：noteId -> timerId）——
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function onNoteInput(note: Note): void {
  const existing = saveTimers.get(note.id);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    note.id,
    setTimeout(() => {
      // 与 legacy 一致：commit 时读 textarea 当前值（期间继续输入也会被收进这次提交）
      const textarea = textareaRefs.get(note.id);
      void updateNote(note.id, textarea ? textarea.value : '');
      saveTimers.delete(note.id);
    }, 500),
  );
}

/** 删除：无确认直接删 + toast（文案/时长与 legacy 一字不差） */
async function onDelete(id: string): Promise<void> {
  await removeNote(id);
  toast('便签已删除', 'success', 1500);
}
</script>

<!-- prettier-ignore -->
<template>
    <section v-show="visible('notes')" class="side-card" id="side-card-notes">
        <header class="side-card-header">
            <h3>便签<span id="notes-card-badge" class="side-badge">{{ stats.total }}</span></h3>
            <button id="notes-card-expand" class="side-expand-btn" title="打开完整面板" @click="openPanel('notes', $event)">⤢</button>
        </header>
        <ul id="notes-card-list" class="side-notes-list notes-list">
            <li v-if="sortedNotes.length === 0" class="notes-empty">还没有便签</li>
            <template v-else>
                <li
                    v-for="note in sortedNotes"
                    :key="note.id"
                    class="note-card"
                    :class="{ pinned: note.pinned }"
                    :data-id="note.id"
                >
                    <div class="note-toolbar">
                        <button
                            class="note-pin-btn"
                            :class="{ active: note.pinned }"
                            :title="note.pinned ? '取消置顶' : '置顶'"
                            :aria-label="note.pinned ? '取消置顶' : '置顶'"
                            @click="togglePin(note.id)"
                            v-html="ICONS.pin"
                        ></button>
                        <button class="note-delete-btn" title="删除便签" aria-label="删除便签" @click="onDelete(note.id)" v-html="ICONS.trash"></button>
                    </div>
                    <textarea
                        class="note-content"
                        placeholder="随手记点什么…（自动保存）"
                        :value="note.content || ''"
                        :ref="(el) => setTextareaRef(note.id, el)"
                        @input="onNoteInput(note)"
                    ></textarea>
                    <div class="note-meta">{{ formatNoteTime(note) }}</div>
                </li>
            </template>
        </ul>
    </section>
</template>
