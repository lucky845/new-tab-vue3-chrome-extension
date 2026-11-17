/**
 * 备忘录数据层（多便签）—— 自 v1.8.1:js/modules/notes-manager.js 等价移植。
 *
 * 业务语义唯一权威是 legacy NotesManager，逐字段对齐：
 *   - 存储 key：'notes'（裸数组，非 JSON 字符串）；旧版单条 key：'note' → 自动迁移
 *   - 数据结构：Note { id, content, pinned, createdAt, updatedAt }
 *   - init：数组且非空才收（只留对象条目），否则置空；'note' 迁移为第一条便签后删除旧 key
 *   - getNotes：置顶优先，同组按 updatedAt 倒序（仅渲染排序，不落盘）
 *   - searchNotes：内容子串、大小写不敏感；空关键词返回全部
 *   - addNote / updateNote / togglePin / removeNote：与 legacy 同名方法语义一致
 *
 * 持久化：useStored 深度 watch 即时写（等价 legacy 每次操作后的 await save()）；
 * 文本输入的 500ms 防抖属 UI 语义，在 NotesPanel.vue 内实现（对应 v1.8.1:js/app.js noteSaveTimers）。
 *
 * 单例设计：'notes' 全应用只允许一份 useStored 实例 —— load 每次从 storage 返回新引用，
 * 多实例会在 storage.onChanged 回声上互相触发写入形成循环。
 */
import { computed } from 'vue';
import { useStored } from '@/src/lib/storage';

export interface Note {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 与 legacy NotesManager.storageKey 一字不差 */
const STORAGE_KEY = 'notes';
/** 与 legacy NotesManager.legacyKey 一字不差（旧版单条便签，迁移源） */
const LEGACY_KEY = 'note';

const notes = useStored<Note[]>(STORAGE_KEY, [], {
  load: (raw): Note[] => {
    // 等价 legacy init()：数组且非空才收，只留对象条目；其余视为空
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.filter((item): item is Note => !!item && typeof item === 'object');
    }
    return [];
  },
});

let migrationStarted = false;

/**
 * 旧版单条便签迁移（等价 legacy NotesManager.init() 的迁移分支）：
 * 'notes' 为空/缺失且 'note' 有 content → 生成 id 为 note_<ts>_migrated 的首条便签，
 * 写回 'notes' 并删除 'note'。直写存储兜底，保证任何 hydrate 时序下数据不丢。
 */
async function migrateLegacySingleNote(): Promise<void> {
  if (migrationStarted) return;
  migrationStarted = true;

  const result = await chrome.storage.local.get([STORAGE_KEY, LEGACY_KEY]);
  const saved = result[STORAGE_KEY];
  const legacy = result[LEGACY_KEY] as Record<string, unknown> | undefined;

  const savedEmpty = !saved || (Array.isArray(saved) && saved.length === 0);
  if (savedEmpty && legacy && typeof legacy === 'object' && legacy.content) {
    const createdAt = typeof legacy.updatedAt === 'number' ? legacy.updatedAt : Date.now();
    const migrated: Note[] = [
      {
        id: `note_${Date.now()}_migrated`,
        content: legacy.content as string,
        pinned: false,
        createdAt,
        updatedAt: createdAt,
      },
    ];
    notes.value = migrated; // 已 hydrate 时由 useStored 深度 watch 落盘
    // 兜底直写：即使初始 get 尚未 hydrate，存储里也已迁移成功，onChanged 会拉回响应式状态
    await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
    await chrome.storage.local.remove(LEGACY_KEY);
  }
}

// 模块加载即触发（幂等），与 legacy boot 时 init() 的时机对齐
void migrateLegacySingleNote();

/** 等价 legacy getNotes()：置顶优先，同组按更新时间倒序；返回新数组 */
function getNotes(): Note[] {
  return [...notes.value].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

/** 响应式排序视图（面板/主页卡片渲染直接用） */
const sortedNotes = computed(() => getNotes());

/** 等价 legacy searchNotes()：内容子串、大小写不敏感；空关键词返回全部 */
function searchNotes(keyword: string): Note[] {
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return getNotes();
  return getNotes().filter((note) => (note.content || '').toLowerCase().includes(kw));
}

/** 等价 legacy addNote()：允许空内容（UI 先建后输入），新便签插到最前 */
async function addNote(content = ''): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: `note_${now}_${Math.random().toString(36).slice(2, 8)}`,
    content: String(content || ''),
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  notes.value.unshift(note);
  return note;
}

/** 等价 legacy updateNote()：空内容不删除便签（删除由用户显式触发） */
async function updateNote(id: string, content: string): Promise<Note | null> {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return null;
  note.content = String(content ?? '');
  note.updatedAt = Date.now();
  return note;
}

/** 等价 legacy togglePin()：置顶切换同样触碰 updatedAt */
async function togglePin(id: string): Promise<Note | null> {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return null;
  note.pinned = !note.pinned;
  note.updatedAt = Date.now();
  return note;
}

/** 等价 legacy removeNote() */
async function removeNote(id: string): Promise<boolean> {
  const index = notes.value.findIndex((n) => n.id === id);
  if (index === -1) return false;
  notes.value.splice(index, 1);
  return true;
}

/** 统计（legacy renderNotesList 的 total / chars）：总条数与全量字数 */
const stats = computed(() => ({
  total: notes.value.length,
  chars: notes.value.reduce((sum, n) => sum + (n.content || '').length, 0),
}));

/** 等价 legacy renderNotesInto 的 note-meta 文案：updatedAt 缺省显示「新便签」 */
export function formatNoteTime(note: Note): string {
  return note.updatedAt
    ? new Date(note.updatedAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '新便签';
}

export function useNotes() {
  return {
    notes,
    sortedNotes,
    getNotes,
    searchNotes,
    addNote,
    updateNote,
    togglePin,
    removeNote,
    stats,
  };
}
