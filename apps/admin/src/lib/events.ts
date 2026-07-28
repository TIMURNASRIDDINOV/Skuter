import { useEffect, useRef, useState } from 'react';
import type { ServerEvent, ServerEventType } from '@scoot/shared';
import { API_URL, getToken } from './api.js';

/**
 * Live server events over SSE.
 *
 * One EventSource for the whole panel, shared through a module-level
 * subscriber set — opening a stream per component would multiply a fleet that
 * already emits ~20 events a second.
 *
 * The token goes in the query string because EventSource cannot set headers.
 */

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connectedListeners = 0;

const statusListeners = new Set<(connected: boolean) => void>();
let connected = false;

function setConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const listener of statusListeners) listener(next);
}

function open(): void {
  if (source !== null) return;
  const token = getToken();
  if (token === null) return;

  source = new EventSource(`${API_URL}/admin/events?token=${encodeURIComponent(token)}`);

  source.addEventListener('ready', () => {
    setConnected(true);
  });

  source.addEventListener('message', (message: MessageEvent<string>) => {
    setConnected(true);
    let event: ServerEvent;
    try {
      event = JSON.parse(message.data) as ServerEvent;
    } catch {
      return;
    }
    for (const listener of listeners) listener(event);
  });

  source.addEventListener('error', () => {
    // EventSource reconnects on its own; reflect the gap in the UI meanwhile.
    setConnected(false);
  });
}

function close(): void {
  source?.close();
  source = null;
  setConnected(false);
}

/**
 * Subscribe to server events, optionally filtered by type.
 *
 * The callback is held in a ref so callers can pass an inline closure without
 * tearing the stream down on every render.
 */
export function useServerEvents(
  onEvent: Listener,
  types?: readonly ServerEventType[],
): void {
  const callback = useRef(onEvent);
  callback.current = onEvent;

  const typeKey = types?.join(',') ?? '';

  useEffect(() => {
    const wanted = typeKey === '' ? null : new Set(typeKey.split(','));
    const listener: Listener = (event) => {
      if (wanted !== null && !wanted.has(event.type)) return;
      callback.current(event);
    };

    listeners.add(listener);
    connectedListeners += 1;
    open();

    return () => {
      listeners.delete(listener);
      connectedListeners -= 1;
      if (connectedListeners === 0) close();
    };
  }, [typeKey]);
}

/** Whether the live stream is currently up, for the header indicator. */
export function useLiveConnection(): boolean {
  const [isConnected, setIsConnected] = useState(connected);

  useEffect(() => {
    const listener = (next: boolean): void => {
      setIsConnected(next);
    };
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }, []);

  return isConnected;
}
