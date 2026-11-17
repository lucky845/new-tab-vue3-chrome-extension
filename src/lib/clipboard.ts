/**
 * 剪贴板写入（唯一实现）
 * --------------------------------------------------------------------
 * navigator.clipboard 在扩展页面、非安全上下文、失焦状态下都可能 reject，
 * 所以保留 textarea + execCommand('copy') 的降级路径（与 v1.8.1 小工具复制逐行一致）。
 * 调用方只需要拿到成功/失败，提示文案各自决定。
 */
export async function copyText(text: string): Promise<boolean> {
    if (!text) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // 降级：临时 textarea 选中后走旧命令式复制
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        ta.remove();
        return ok;
    }
}
