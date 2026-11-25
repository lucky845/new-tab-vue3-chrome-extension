<script setup lang="ts">
/**
 * 主页右翼便签迷你卡 —— markup 逐字来自 entrypoints/newtab.html:208-214（#side-card-notes）。
 *
 * legacy 映射（v1.8.1:js/app.js）：
 * - renderNotesCard（1122-1132）：全量 getNotes() + 徽标 getNotes().length、空态 '还没有便签'
 * - renderNotesInto（1044-1120，覆盖 966-1042 的同名定义）：note-card 结构 + 500ms 防抖自动保存
 * - 展开按钮：外壳 SideCard 记录 panelOrigin 后 toggle('notes')
 *
 * 与 NotesPanel 共享 useNotes 单例；便签列表从不挂 Sortable。
 * 显隐 / 展开按钮 / 头部由 SideCard 外壳统一承载，本组件只管卡片主体。
 */
import SideCard from '@/src/components/common/SideCard.vue';
import { useNotes, formatNoteTime } from '@/src/composables/useNotes';
import { useNoteCardActions } from '@/src/composables/useNoteCardActions';
import { ICON_TRASH } from '@/src/lib/icons';
import { t } from '@/src/composables/useI18n';

const { sortedNotes, stats, togglePin } = useNotes();

/** legacy AppIcons —— pin 仅本卡用（留在本地），trash 抽到共享 */
const ICONS = {
  pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>',
  trash: ICON_TRASH,
} as const;

// textarea 引用 / 500ms 防抖自动保存 / 删除：与 NotesPanel 共享同一套实现
const { setTextareaRef, onNoteInput, onDelete } = useNoteCardActions();
</script>

<!-- prettier-ignore -->
<template>
    <SideCard cardId="notes" elementId="side-card-notes" :title="t('side_card_notes')" :badge="stats.total" badgeId="notes-card-badge" expandId="notes-card-expand">
        <ul id="notes-card-list" class="side-notes-list notes-list">
            <li v-if="sortedNotes.length === 0" class="notes-empty">{{ t('notes_empty_all') }}</li>
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
                            :title="note.pinned ? t('notes_unpin') : t('notes_pin')"
                            :aria-label="note.pinned ? t('notes_unpin') : t('notes_pin')"
                            @click="togglePin(note.id)"
                            v-html="ICONS.pin"
                        ></button>
                        <button class="note-delete-btn" :title="t('notes_delete')" :aria-label="t('notes_delete')" @click="onDelete(note.id)" v-html="ICONS.trash"></button>
                    </div>
                    <textarea
                        class="note-content"
                        :placeholder="t('notes_input_placeholder')"
                        :value="note.content || ''"
                        :ref="(el) => setTextareaRef(note.id, el)"
                        @input="onNoteInput(note)"
                    ></textarea>
                    <div class="note-meta">{{ formatNoteTime(note) }}</div>
                </li>
            </template>
        </ul>
    </SideCard>
</template>
