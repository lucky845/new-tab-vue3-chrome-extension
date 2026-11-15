/** 快捷访问节点：站点或文件夹（与 QuickAccessManager 的数据结构逐字一致）。 */
export interface QuickAccessNode {
  name: string;
  url?: string;
  icon?: string | null;
  isFolder?: boolean;
  items?: QuickAccessNode[];
  id?: string | number;
}
