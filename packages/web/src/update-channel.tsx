/**
 * Update channel (user request, 2026-09-03): stable vs beta. Persisted in
 * localStorage, cross-window synced via the shared pref bridge (same
 * mechanism as language/theme). The updater endpoint follows the channel:
 * releases/latest/download/latest.json          → stable
 * releases/latest/download/latest-beta.json     → beta
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { broadcastPref, listenPrefs } from './pref-sync';

export type UpdateChannel = 'stable' | 'beta';

const STORAGE_KEY = 'ghpb.updateChannel';

interface ChannelCtx {
  channel: UpdateChannel;
  setChannel: (c: UpdateChannel) => void;
}

const Ctx = createContext<ChannelCtx>({ channel: 'stable', setChannel: () => {} });

export function UpdateChannelProvider({ children }: { children: ReactNode }) {
  const [channel, setChannelState] = useState<UpdateChannel>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'beta' ? 'beta' : 'stable';
    } catch {
      return 'stable';
    }
  });

  const setChannel = useCallback((c: UpdateChannel) => {
    setChannelState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* session-only */
    }
    broadcastPref('updateChannel', c);
  }, []);

  // Another window (desktop prefs) changed the channel.
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key === 'updateChannel' && (v === 'beta' || v === 'stable')) {
          setChannelState(v);
          try {
            localStorage.setItem(STORAGE_KEY, v);
          } catch {
            /* session-only */
          }
        }
      }),
    [],
  );

  const value = useMemo(() => ({ channel, setChannel }), [channel, setChannel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdateChannel(): ChannelCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUpdateChannel outside UpdateChannelProvider');
  return ctx;
}

/** Updater feed URL for a channel (public release assets). */
export function channelFeedUrl(c: UpdateChannel): string {
  return c === 'beta'
    ? 'https://github.com/GH-FRC/pathblender/releases/latest/download/latest-beta.json'
    : 'https://github.com/GH-FRC/pathblender/releases/latest/download/latest.json';
}
