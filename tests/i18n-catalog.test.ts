import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { resolve } from 'node:path';
import { catalog } from '@/src/locales/catalog';
import { SUPPORTED_LOCALES } from '@/src/lib/i18n';

/**
 * locales 目录下的 yml 是 WXT 生成 _locales 下 messages.json 的唯一来源（manifest 的
 * __MSG_*__ 与商店元数据靠它）；src/locales/catalog.ts 是运行时可查表的副本。
 * 两边必须同 key，否则会出现「商店里是英文、界面里还是英文/或反过来」的分裂。
 */
function parseYmlKeys(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.match(/^([A-Za-z0-9_]+):/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

describe('i18n 文案表与 yml 源一致', () => {
  // 构建时 @wxt-dev/i18n 用 YAML 解析这些文件；值里出现 ": "、以特殊符号开头
  // 等情况必须加引号，否则 npm run build 直接失败而单元测试看不出来。
  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}.yml 能被 YAML 解析（值含冒号时必须加引号）`, () => {
      const raw = readFileSync(resolve(process.cwd(), 'locales', `${locale}.yml`), 'utf8');
      const parsed = yaml.load(raw) as Record<string, unknown>;
      expect(typeof parsed).toBe('object');
      for (const [key, value] of Object.entries(parsed)) {
        expect(typeof value, `${locale}.${key} 必须是字符串`).toBe('string');
      }
    });
  }

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}.yml 与 catalog 的 key 集合一致`, () => {
      const raw = readFileSync(resolve(process.cwd(), 'locales', `${locale}.yml`), 'utf8');
      const ymlKeys = parseYmlKeys(raw).sort();
      const catalogKeys = Object.keys(catalog[locale] ?? {}).sort();
      expect(catalogKeys).toEqual(ymlKeys);
    });
  }

  it('每个 key 在所有语言里都有非空译文', () => {
    const allKeys = new Set<string>();
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of Object.keys(catalog[locale] ?? {})) allKeys.add(key);
    }
    for (const key of allKeys) {
      for (const locale of SUPPORTED_LOCALES) {
        const value = catalog[locale]?.[key];
        expect(value, `缺少 ${locale} 的 ${key}`).toBeTruthy();
      }
    }
  });
});
