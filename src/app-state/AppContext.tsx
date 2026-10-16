import { createContext, DependencyList, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AppServices } from '../services/appServices';

interface AppContextValue {
  services: AppServices;
  /** Increments whenever data changes, so screens can refetch. */
  version: number;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  useEffect(() => services.subscribe(() => setVersion((v) => v + 1)), [services]);
  return <AppContext.Provider value={{ services, version }}>{children}</AppContext.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useServices must be used inside AppProvider');
  return ctx.services;
}

export function useDataVersion(): number {
  return useContext(AppContext)?.version ?? 0;
}

export interface AsyncData<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Loads data with `load` and reloads it whenever the database changes or `deps` change.
 * Keeps showing the previous data while reloading to avoid flicker.
 * `deps` form the request key; objects are compared by their JSON content.
 */
export function useLiveQuery<T>(load: () => Promise<T>, deps: DependencyList): AsyncData<T> {
  const version = useDataVersion();
  const [nonce, setNonce] = useState(0);
  const key = [version, nonce, ...deps]
    .map((d) => (d !== null && typeof d === 'object' ? JSON.stringify(d) : String(d)))
    .join('\u0001');
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; key: string | null }>({
    data: undefined,
    error: null,
    key: null,
  });
  const latestKey = useRef(key);

  useEffect(() => {
    latestKey.current = key;
    load().then(
      (data) => {
        if (latestKey.current === key) setState({ data, error: null, key });
      },
      (error: Error) => {
        if (latestKey.current === key) setState((s) => ({ ...s, error, key }));
      },
    );
    // `load` is intentionally excluded: it is recreated every render and `key` captures its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}
