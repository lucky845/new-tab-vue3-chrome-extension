/**
 * 玻璃宿主 pointer-events 继承闸门的契约测试。
 *
 * 背景（真机缺陷，User said m03261："历史搜索面板鼠标会出现穿透无法点击到，
 * 而是会点击下去下面的快捷访问图标"）：
 * public/theme/app.css 里有统一闸门
 *   [data-glass='lib'] { pointer-events: none }
 * 目的是「玻璃不接管光标」，但 pointer-events 是**继承属性**——它会把整棵子树
 * 一起关掉，只有白名单里的 a/button/input 能靠自己的 auto 重新打开。
 * 搜索历史行是 .history-item(div) / .history-text(span)，都不在白名单里，
 * 于是「固定」「删除」两个 button 能点、点正文却穿透到下面的快捷访问格子。
 *
 * 这是 CSS 层缺陷：vitest environment=node 没有布局引擎，无法用 getComputedStyle
 * 断言真实命中。这里退一步守住**契约本身**——只要闸门存在，下拉容器与后代的
 * auto 规则就必须存在、且排在闸门之后（同特异性靠顺序取胜）。真实命中验证
 * 由 CDP 探针承担（elementFromPoint 在历史词中心命中 .history-text）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS_PATH = fileURLToPath(new URL('../public/theme/app.css', import.meta.url));
const raw = readFileSync(CSS_PATH, 'utf8');
/** 剔除注释后再解析，否则注释里的选择器样例会干扰匹配 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selectors: string[];
  body: string;
  at: number;
}

/** 扁平解析（app.css 无嵌套规则，按「选择器{声明}」逐个切即可） */
function parseRules(source: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    rules.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      body: m[2],
      at: m.index,
    });
  }
  return rules;
}

const rules = parseRules(css);

/** 在所有规则里找「某个选择器作为独立项出现」且声明含指定属性的第一条 */
function findRule(selector: string, prop: string, value: string): Rule | undefined {
  return rules.find(
    (r) =>
      r.selectors.includes(selector) &&
      new RegExp('(^|;|\\s)' + prop + '\\s*:\\s*' + value).test(r.body)
  );
}

describe('玻璃宿主 pointer-events 闸门', () => {
  it('闸门本身存在（所有继承问题的源头，删它要同步删本测试）', () => {
    const gate = findRule("[data-glass='lib']", 'pointer-events', 'none');
    expect(gate, "[data-glass='lib'] { pointer-events: none } 不存在").toBeDefined();
  });

  it('下拉容器自身要能从继承的 none 里恢复 auto', () => {
    for (const sel of ['.search-engine-dropdown', '.search-history-dropdown']) {
      expect(findRule(sel, 'pointer-events', 'auto'), sel + ' 缺少 pointer-events:auto').toBeDefined();
    }
  });

  it('下拉后代也必须显式恢复（容器 auto 不会覆盖已经继承下去的 none）', () => {
    for (const sel of ['.search-engine-dropdown *', '.search-history-dropdown *']) {
      expect(findRule(sel, 'pointer-events', 'auto'), sel + ' 缺少 pointer-events:auto').toBeDefined();
    }
  });

  it('auto 规则必须排在 none 闸门之后（同特异性靠源码顺序取胜）', () => {
    const gate = findRule("[data-glass='lib']", 'pointer-events', 'none')!;
    const fix = findRule('.search-history-dropdown *', 'pointer-events', 'auto')!;
    expect(gate).toBeDefined();
    expect(fix).toBeDefined();
    expect(fix.at).toBeGreaterThan(gate.at);
  });

  it('历史行正文仍是非按钮标签（改成 button 则本契约前提需重估）', () => {
    const vue = readFileSync(fileURLToPath(new URL('../src/components/SearchBlock.vue', import.meta.url)), 'utf8');
    expect(vue).toMatch(/<span class="history-text"/);
  });
});
