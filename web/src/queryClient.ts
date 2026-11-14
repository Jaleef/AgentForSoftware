/**
 * React Query 客户端。
 *
 * 统一缓存、加载/错误状态和失效刷新；页面不再自己维护请求状态机。
 */

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
