/**
 * 前端通用 hooks。
 *
 * 资源加载使用 @tanstack/react-query；保留防抖和轮询辅助函数。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface ResourceOptions {
  /** Stable resource name; prevents different resources on one page sharing a cache key. */
  key: string;
  enabled?: boolean;
  refetchInterval?: number | false;
}

/**
 * 加载一个异步资源并暴露 data/loading/error/reload/setData。
 *
 * 调用 useQuery；queryKey 由 deps 派生，组件卸载/参数变化时由 React Query
 * 处理竞态、缓存和取消。setData 用于评价轮询拿到轻量状态后同步缓存。
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: ResourceOptions,
) {
  const queryClient = useQueryClient();
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const queryKey = ["resource", options.key, ...deps];
  const query = useQuery({
    queryKey,
    queryFn: () => loaderRef.current(),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });

  const reload = useCallback(() => query.refetch(), [query]);
  const setData = useCallback(
    (value: T) => queryClient.setQueryData(queryKey, value),
    [queryClient, queryKey],
  );

  return {
    data: (query.data ?? null) as T | null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending,
    reload,
    setData,
  };
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
