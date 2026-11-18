import { describe, it, expect } from 'vitest';
import {
  scanHtmlForRemoteCode,
  scanJsForRemoteCode,
  scanFileForRemoteCode,
  isRemoteUrlForCode,
} from '../scripts/remote-code-check.mjs';

describe('remote-code-check · URL 口径', () => {
  it('http(s) 与协议相对 URL 视为远程', () => {
    expect(isRemoteUrlForCode('https://cdn.example.com/a.js')).toBe(true);
    expect(isRemoteUrlForCode('http://x.com/a.js')).toBe(true);
    expect(isRemoteUrlForCode('//cdn.example.com/a.js')).toBe(true);
  });
  it('本地路径 / data / blob / chrome-extension 不是远程', () => {
    expect(isRemoteUrlForCode('/chunks/main.js')).toBe(false);
    expect(isRemoteUrlForCode('./a.js')).toBe(false);
    expect(isRemoteUrlForCode('data:text/javascript,x')).toBe(false);
    expect(isRemoteUrlForCode('blob:https://x/uuid')).toBe(false);
    expect(isRemoteUrlForCode('chrome-extension://abc/a.js')).toBe(false);
    expect(isRemoteUrlForCode('')).toBe(false);
  });
});

describe('remote-code-check · HTML 远程脚本', () => {
  it('拦截远程 script src（双引号 / 单引号 / 协议相对）', () => {
    expect(scanHtmlForRemoteCode('<script src="https://cdn.x.com/a.js"></script>')).toHaveLength(1);
    expect(scanHtmlForRemoteCode("<script src='http://x.com/a.js'></script>")).toHaveLength(1);
    expect(scanHtmlForRemoteCode('<script src="//cdn.x.com/a.js"></script>')).toHaveLength(1);
  });
  it('本地 script src 不拦', () => {
    expect(scanHtmlForRemoteCode('<script src="/theme-preboot.js"></script>')).toHaveLength(0);
    expect(scanHtmlForRemoteCode('<script type="module" crossorigin src="/chunks/a.js"></script>')).toHaveLength(0);
    expect(scanHtmlForRemoteCode('<script>window.x=1</script>')).toHaveLength(0);
  });
  it('拦截远程 modulepreload，不拦本地 link stylesheet', () => {
    expect(scanHtmlForRemoteCode('<link rel="modulepreload" href="https://cdn.x.com/a.js">')).toHaveLength(1);
    expect(scanHtmlForRemoteCode('<link rel="stylesheet" href="/a.css">')).toHaveLength(0);
    expect(scanHtmlForRemoteCode('<link rel="stylesheet" href="https://fonts.googleapis.com/x.css">')).toHaveLength(0);
  });
  it('img src 的远程 URL 不算脚本加载', () => {
    expect(scanHtmlForRemoteCode('<img src="https://picsum.photos/200">')).toHaveLength(0);
  });
});

describe('remote-code-check · JS 远程模块', () => {
  it('拦截动态 import 远程 URL', () => {
    expect(scanJsForRemoteCode('import("https://cdn.x.com/a.js")')).toHaveLength(1);
    expect(scanJsForRemoteCode("import('http://x.com/a.js')")).toHaveLength(1);
    expect(scanJsForRemoteCode('import(`//cdn.x.com/a.js`)')).toHaveLength(1);
  });
  it('拦截静态 from 与副作用 import 远程 URL', () => {
    expect(scanJsForRemoteCode('import x from "https://cdn.x.com/a.js"')).toHaveLength(1);
    expect(scanJsForRemoteCode('export { x } from "https://cdn.x.com/a.js"')).toHaveLength(1);
    expect(scanJsForRemoteCode('import "https://cdn.x.com/a.js"')).toHaveLength(1);
  });
  it('本地 import 不拦', () => {
    expect(scanJsForRemoteCode('import { x } from "./a.js"')).toHaveLength(0);
    expect(scanJsForRemoteCode('import x from "/chunks/a.js"')).toHaveLength(0);
    expect(scanJsForRemoteCode('import.meta.env')).toHaveLength(0);
  });
  it('fetch / new URL / CSP 白名单 URL 不算远程代码', () => {
    expect(scanJsForRemoteCode('fetch("https://api.open-meteo.com/v1/forecast")')).toHaveLength(0);
    expect(scanJsForRemoteCode('new URL("https://www.baidu.com")')).toHaveLength(0);
    expect(scanJsForRemoteCode("const CSP=\"script-src 'self'; img-src https://t0.gstatic.com\"")).toHaveLength(0);
    expect(scanJsForRemoteCode('const NS="http://www.w3.org/2000/svg"')).toHaveLength(0);
  });
});

describe('remote-code-check · 文件分发', () => {
  it('按扩展名选扫描器，其余类型跳过', () => {
    expect(scanFileForRemoteCode('a.html', '<script src="https://x.com/a.js"></script>')).toHaveLength(1);
    expect(scanFileForRemoteCode('a.js', 'import("https://x.com/a.js")')).toHaveLength(1);
    expect(scanFileForRemoteCode('a.css', '@import url("https://x.com/a.css")')).toHaveLength(0);
    expect(scanFileForRemoteCode('a.json', '{"url":"https://x.com/a.js"}')).toHaveLength(0);
  });
});
