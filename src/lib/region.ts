/**
 * 界面语言 → 默认站点地区。
 *
 * 只看语言，不做 IP 探测：IP 探测要为一次首装决策多申请一个域名权限（PRIVACY 里
 * 就得写「会读你的 IP」），而 chrome.i18n.getUILanguage() 是本地同步、零网络。
 * 语言判断错了的代价也小——用户改几个快捷访问比接受一次额外的数据收集便宜。
 */
import type { SiteRegion } from '@/src/config/defaultSites';

/** 中文界面（zh-CN / zh-TW / zh-HK …）落到国内站点组 */
export function isChineseUi(lang: string | undefined | null): boolean {
    return /^zh\b/i.test(String(lang || '').trim());
}

/** 读浏览器界面语言；脱离扩展环境（本地预览页）时退回 navigator.language */
export function uiLanguage(): string {
    try {
        if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
            const lang = chrome.i18n.getUILanguage();
            if (lang) return lang;
        }
    } catch {
        // getUILanguage 在部分非扩展上下文会抛，忽略即可
    }
    return typeof navigator === 'undefined' ? '' : navigator.language || '';
}

/** 默认站点地区：中文界面用国内组，其余用境外组 */
export function defaultSiteRegion(): SiteRegion {
    return isChineseUi(uiLanguage()) ? 'cn' : 'global';
}
