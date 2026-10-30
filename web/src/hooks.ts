/**
 * 前端通用 hooks。
 *
 * 提供资源加载、防抖和定时轮询。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 加载一个异步资源并暴露 loading/error/reload。
 *
 * 组件卸载后忽略过期响应。
 */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loaderRef
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((err: Error) => {
        if (!alive) return;
        setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * 对快速变化的值做防抖。
 *
 * 常用于搜索输入，避免每次按键都触发请求或重算。
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * 在组件生命周期内按固定间隔执行回调。
 *
 * intervalMs 为 null 时暂停，卸载时自动清理。
 */
export function useInterval(callback: () => void, intervalMs: number | null) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (intervalMs === null) return;
    const timer = setInterval(() => saved.current(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
