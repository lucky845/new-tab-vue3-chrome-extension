/**
 * 便签卡片/面板共享的「500ms 防抖自动保存 + textarea 引用」逻辑。
 *
 * 原来 NotesCard.vue 与 NotesPanel.vue 各写一份完全相同的 textareaRefs /
 * setTextareaRef / saveTimers / onNoteInput / onDelete，连注释都逐字重复。
 * 抽成 composable 后两处只留一行调用，行为不变：
 * - commit 时读 textarea 当前值（期间继续输入会被一并收进这次提交）；
 * - 删除无确认，toast「便签已删除」success 1500ms；
 * - onUnmounted 清掉未落盘 timer，避免卸载后写脏数据。
 */
import { onUnmounted } from 'vue';
import { useNotes, type Note } from '@/src/composables/useNotes';
import { toast } from '@/src/composables/useToast';

export function useNoteCardActions() {
  const { updateNote, removeNote } = useNotes();

  const textareaRefs = new Map<string, HTMLTextAreaElement>();
  function setTextareaRef(id: string, el: unknown): void {
    const ta = el as HTMLTextAreaElement | null;
    if (ta) textareaRefs.set(id, ta);
    else textareaRefs.delete(id);
  }

  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function onNoteInput(note: Note): void {
    const existing = saveTimers.get(note.id);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      note.id,
      setTimeout(() => {
        const textarea = textareaRefs.get(note.id);
        void updateNote(note.id, textarea ? textarea.value : "");
        saveTimers.delete(note.id);
      }, 500),
    );
  }

  async function onDelete(id: string): Promise<void> {
    await removeNote(id);
    toast('便签已删除', 'success', 1500);
  }

  onUnmounted(() => {
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
  });

  return { textareaRefs, setTextareaRef, onNoteInput, onDelete };
}
