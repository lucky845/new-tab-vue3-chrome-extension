<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { usePanels } from '@/src/composables/usePanels';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { useNotes, formatNoteTime, type Note } from '@/src/composables/useNotes';
import { toast } from '@/src/composables/useToast';

/**
 * 备忘录面板 —— legacy #notes-panel 的 Vue3 移植。
 *
 * 与 legacy 的对应关系（逐条可溯）：
 *   - 面板 markup：entrypoints/newtab.html #notes-panel 逐字搬入；仅许可改动：
 *     ①静态事件逻辑改 @click ②根元素 u-hidden 改由 usePanels 驱动；
 *     另将 bindNotesEvents 的背板点击关闭（e.target === notesPanel）等价移植为根元素 @click.self。
 *   - 列表条目：app.js renderNotesInto 的 DOM 构树 → v-for 模板（类名/文案/SVG 一字不动）。
 *   - 渲染入口：renderNotesList → filteredNotes / emptyText / metaText 三个 computed。
 *   - 新建聚焦：notesList.querySelector(li[data-id] textarea).focus() → 模板 ref Map + nextTick。
 *   - 自动保存：app.js noteSaveTimers 的 500ms 防抖；commit 时读 textarea 实时值（与 legacy 闭包读法一致）。
 *   - 删除：无确认、直接删 + toast('便签已删除', 'success', 1500)（返回值判否与 legacy 一致地省略）。
 *   - legacy 对 notes 列表从未挂 Sortable（仅 todo/folder 有），此处同样不加拖拽。
 */
const { isOpen, close } = usePanels();
const { searchNotes, addNote, updateNote, togglePin, removeNote, stats } = useNotes();

/** 搜索关键词（legacy notesKeyword） */
const keyword = ref('');

/** 过滤后的列表（等价 renderNotesList 里 searchNotes(this.notesKeyword) 的取数） */
const filteredNotes = computed(() => searchNotes(keyword.value));

/** 空态文案：有关键词=没有匹配；否则默认文案（与 legacy renderNotesList 传参一字不差） */
const emptyText = computed(() =>
  keyword.value ? '没有匹配的便签' : '还没有便签，点「＋ 新便签」开始记录',
);

/** 统计行（等价 notesMeta.textContent）：共 N 条便签 · M 字（自动保存） */
const metaText = computed(
  () => `共 ${stats.value.total} 条便签 · ${stats.value.chars} 字（自动保存）`,
);

// —— textarea 模板 ref：对应 legacy 的 notesList.querySelector(li[data-id="..."] textarea) ——
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

/** 新建便签：addNote('') 后聚焦新 textarea（等价 legacy notesAddBtn click 分支） */
async function onAddNote(): Promise<void> {
  const note = await addNote('');
  await nextTick();
  textareaRefs.get(note.id)?.focus();
}

/** 置顶切换（legacy togglePin 后走 renderNotesList；Vue 由响应式自动重渲染） */
async function onTogglePin(id: string): Promise<void> {
  await togglePin(id);
}

/** 删除：无确认直接删 + toast（文案/时长与 legacy 一字不差） */
async function onDelete(id: string): Promise<void> {
  await removeNote(id);
  toast('便签已删除', 'success', 1500);
}
</script>

<template>
  <!-- 备忘录面板 -->
  <GlassPanel
    panelId="notes"
    :open="isOpen('notes')"
    variant="widget"
    elementId="notes-panel"
    @dismiss="close('notes')"
  >
    <div class="widget-content">
      <div class="widget-header">
        <h2>备忘录</h2>
        <button id="close-notes-btn" class="control-btn widget-close-btn" title="关闭" @click="close('notes')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="notes-toolbar">
        <input
          type="text"
          id="notes-search-input"
          class="notes-search-input"
          placeholder="搜索便签…"
          maxlength="50"
          v-model="keyword"
        />
        <button id="notes-add-btn" class="settings-btn" title="新建便签" @click="onAddNote">＋ 新便签</button>
      </div>
      <ul id="notes-list" class="notes-list">
        <li v-if="filteredNotes.length === 0" class="notes-empty">{{ emptyText }}</li>
        <template v-else>
          <li
            v-for="note in filteredNotes"
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
                @click="onTogglePin(note.id)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>
              </button>
              <button class="note-delete-btn" title="删除便签" aria-label="删除便签" @click="onDelete(note.id)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
              </button>
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
      <div class="notes-meta" id="notes-meta">{{ metaText }}</div>
    </div>
  </GlassPanel>
</template>
