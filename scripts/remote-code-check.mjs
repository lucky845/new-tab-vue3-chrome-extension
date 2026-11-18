/**
 * 扩展产物「远程代码」扫描核心（R6 门禁，纯函数，Node 环境运行）。
 *
 * Chrome Web Store 政策：扩展包内不得加载远程托管的可执行代码（script src / import）。
 * 一旦出现即即时下架，所以 CI 必须在打包后扫描产物把这条红线卡死。
 *
 * 检测边界（务必区分「加载远程代码」与「请求远程数据」）：
 *   - 拦：HTML 的 <script src="https://...">、<link rel=modulepreload href=远程>
 *   - 拦：JS 里 import("https://...") / import('http://...') / from "https://..."
 *   - 放行：fetch("https://api...") / new URL("https://...") / <img src=https://...>
 *            / CSP 白名单 / SVG 命名空间 xmlns / 注释与字符串里的普通 URL
 *
 * 只做静态文本扫描，不执行产物代码。匹配用宽松正则 + 白名单复核，宁可漏报
 * 变形写法也不误报合法 https URL —— 误报会让每次构建都红灯，比漏报更致命。
 */

/** 协议相对 //host/path 也算远程；data/blob/chrome-extension 等不是远程代码 */
const REMOTE_URL = /^(?:https?:)?\/\//i;

function isRemote(value) {
  return typeof value === 'string' && REMOTE_URL.test(value.trim());
}

/**
 * 扫描 HTML 文本里的远程脚本加载。
 * 只匹配 src/href 属性值以 http(s):// 或 // 开头的 script / modulepreload 标签。
 */
export function scanHtmlForRemoteCode(html) {
  const findings = [];
  if (typeof html !== 'string' || !html) return findings;
  // <script ... src="..." ...> 与 <link rel=modulepreload href="...">
  const tagRe = /<(script|link)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    const attrRe = /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let a;
    while ((a = attrRe.exec(attrs)) !== null) {
      const name = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (tag === 'script' && name === 'src' && isRemote(value)) {
        findings.push({ type: 'remote-script-src', value, snippet: m[0].slice(0, 160) });
      }
      if (tag === 'link' && name === 'href' && /modulepreload/i.test(attrs) && isRemote(value)) {
        findings.push({ type: 'remote-modulepreload', value, snippet: m[0].slice(0, 160) });
      }
    }
  }
  return findings;
}

/**
 * 扫描 JS 文本里的远程模块加载（动态 import 与静态 from）。
 * 只认 import( 紧跟引号里的 URL，和 from 后紧跟引号里的 URL。
 */
export function scanJsForRemoteCode(js) {
  const findings = [];
  if (typeof js !== 'string' || !js) return findings;
  // 动态 import("https://...") / import('http://...') / import(`//host`)
  const dynamicRe = /\bimport\s*\(\s*(["'`])([^"'`]+)\1/g;
  let m;
  while ((m = dynamicRe.exec(js)) !== null) {
    if (isRemote(m[2])) findings.push({ type: 'remote-dynamic-import', value: m[2] });
  }
  // 静态 import x from "https://..." / export ... from 'http://...'
  const staticRe = /\bfrom\s*(["'])([^"']+)\1/g;
  while ((m = staticRe.exec(js)) !== null) {
    if (isRemote(m[2])) findings.push({ type: 'remote-static-import', value: m[2] });
  }
  // import "https://..."（纯副作用导入，无 from）
  const bareRe = /\bimport\s*(["'])([^"']+)\1/g;
  while ((m = bareRe.exec(js)) !== null) {
    if (isRemote(m[2])) findings.push({ type: 'remote-bare-import', value: m[2] });
  }
  return findings;
}

/** 按文件扩展名分发到 HTML / JS 扫描器；其余扩展名返回空。 */
export function scanFileForRemoteCode(filePath, content) {
  if (/\.html?$/i.test(filePath)) return scanHtmlForRemoteCode(content);
  if (/\.(?:m?js|cjs)$/i.test(filePath)) return scanJsForRemoteCode(content);
  return [];
}

/** 供测试确认白名单口径：这些不是远程代码 */
export function isRemoteUrlForCode(value) {
  return isRemote(value);
}
