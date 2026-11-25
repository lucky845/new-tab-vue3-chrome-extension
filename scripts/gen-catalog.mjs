/**
 * 文案表生成：locales/<locale>.yml → src/locales/catalog.ts
 *
 * 为什么需要这一步：@wxt-dev/i18n 的构建只负责 yml → _locales/<locale>/messages.json
 * （给 manifest 的 __MSG_*__ 和浏览器 i18n 用），运行时整包查表要靠这个文件。
 * 单测 tests/i18n-catalog.test.ts 会校验两者 key 一致，改完 yml 记得跑一次。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOCALES = ['zh_CN', 'en'];

function parseYml(raw) {
  // 只解析本仓库用到的扁平 key: value 结构（不引第三方 yaml，避免把解析差异带进产物）
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (value.startsWith('"')) value = JSON.parse(value);
    out[m[1]] = value;
  }
  return out;
}

const catalog = {};
for (const locale of LOCALES) {
  catalog[locale] = parseYml(readFileSync(resolve(ROOT, 'locales', locale + '.yml'), 'utf8'));
}

const header = "/**\n * 文案表的运行时副本（由 scripts/gen-catalog.mjs 生成，勿手改）。\n *\n * 为什么不直接用 @wxt-dev/i18n 的 t()：它的实现就是 browser.i18n.getMessage(key)，\n * 语言恒等于浏览器 UI 语言，全包没有任何切换语言的 API。我们要支持\n * 「自动 / 中文 / English」用户开关，所以语言解析自己做（见 @/src/lib/i18n.ts）。\n */";

const body = header + '\nimport type { Catalog } from \'@/src/lib/i18n\';\n\nexport const catalog: Catalog = ' +
  JSON.stringify(catalog, null, 4) + ';\n';

writeFileSync(resolve(ROOT, 'src', 'locales', 'catalog.ts'), body);
console.log('[gen-catalog] ' + Object.keys(catalog.zh_CN).length + ' keys × ' + LOCALES.length + ' locales');
