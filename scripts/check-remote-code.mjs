#!/usr/bin/env node
/**
 * R6 门禁 CLI：扫描构建产物，发现远程代码加载即非零退出。
 *
 * 用法：
 *   node scripts/check-remote-code.mjs [dir ...]
 * 默认扫描 .output 下的 chrome-mv3 / edge-mv3 / firefox-mv2 三个产物目录。
 * CI 在 wxt zip 之后调用，任一产物含远程 script/import 立即失败。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { scanFileForRemoteCode } from './remote-code-check.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'sources']);

/** 递归收集待扫描文件（只挑 html/js），返回绝对路径数组 */
function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(?:html?|m?js|cjs)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const root = process.cwd();
const argvDirs = process.argv.slice(2);
const dirs = argvDirs.length
  ? argvDirs.map(d => resolve(root, d))
  : ['chrome-mv3', 'edge-mv3', 'firefox-mv2']
      .map(d => resolve(root, '.output', d))
      .filter(d => existsSync(d));

if (dirs.length === 0) {
  console.error('[remote-code-check] 没有找到可扫描的产物目录（.output/chrome-mv3 等）');
  process.exit(2);
}

let totalFiles = 0;
const violations = [];
for (const dir of dirs) {
  const files = collectFiles(dir);
  totalFiles += files.length;
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const findings = scanFileForRemoteCode(file, content);
    for (const finding of findings) {
      violations.push({ file: relative(root, file), ...finding });
    }
  }
}

if (violations.length) {
  console.error('[remote-code-check] ✗ 检测到远程代码加载，构建失败：');
  for (const v of violations) {
    console.error('  ' + v.file + ' [' + v.type + '] ' + v.value);
    if (v.snippet) console.error('      ' + v.snippet);
  }
  process.exit(1);
}

console.log('[remote-code-check] ✓ ' + totalFiles + ' 个文件，未发现远程代码加载（R6 门禁通过）');
