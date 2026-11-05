import { createContext, useContext, type ReactNode } from 'react';
import { useFetch } from './lib/useFetch';
import type { Module } from './types';

interface ModulesState {
  modules: Module[];
  loading: boolean;
  error: string | null;
  isEnabled: (key: string) => boolean;
  reload: () => void;
}

const ModulesContext = createContext<ModulesState>({
  modules: [],
  loading: true,
  error: null,
  isEnabled: () => true,
  reload: () => {},
});

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useFetch<{ modules: Module[] }>('/modules');
  const modules = data?.modules ?? [];
  const enabled = new Set(modules.filter((module) => module.enabled).map((module) => module.key));

  return (
    <ModulesContext.Provider
      value={{
        modules,
        loading,
        error,
        // While loading (or if the request fails) fail open so the app stays usable.
        isEnabled: (key) => loading || Boolean(error) || enabled.has(key),
        reload,
      }}
    >
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules(): ModulesState {
  return useContext(ModulesContext);
}
