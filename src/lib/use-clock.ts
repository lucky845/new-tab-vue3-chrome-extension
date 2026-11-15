import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 时钟：不放进 Vue 的响应式 tick 里统一驱动。
 *
 * 原因：时钟每秒变化一次，如果放在 App 的根响应式里，每次 tick 都会让整个
 * 组件树走一遍 patch。用单独的组合式函数把它关在自己的 ref 里，只有读它的
 * 组件会更新。
 */
export function useClock() {
  const time = ref('--:--');
  const date = ref('');
  const greeting = ref('');
  let timer: number | undefined;

  const greetingFor = (hour: number): string => {
    if (hour < 6) return '夜深了';
    if (hour < 9) return '早上好';
    if (hour < 12) return '上午好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    if (hour < 23) return '晚上好';
    return '夜深了';
  };

  const tick = () => {
    const now = new Date();
    time.value = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    date.value = now.toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    greeting.value = greetingFor(now.getHours());
  };

  onMounted(() => {
    tick();
    // 对齐到下一分钟再起 60s 心跳：直接 setInterval(1000) 会让秒数对齐漂移，
    // 且第一次刷新可能发生在「分钟已过但定时器还没到」的空窗里。
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    window.setTimeout(() => {
      tick();
      timer = window.setInterval(tick, 60_000);
    }, msToNextMinute);
  });

  onBeforeUnmount(() => {
    if (timer !== undefined) window.clearInterval(timer);
  });

  return { time, date, greeting };
}
