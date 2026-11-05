import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';

export function useFetch<T>(path: string | null, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((result) => {
        if (live) setData(result);
      })
      .catch((err) => {
        if (live) setError(errorMessage(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // The caller controls refetching via path plus the deps it passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  return { data, loading, error, reload: () => setTick((value) => value + 1), setData };
}
