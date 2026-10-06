import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENDA_REALTIME_DEBOUNCE_MS,
  AGENDA_REALTIME_TABLES,
  useAgendaRealtime,
} from '../hooks/useAgendaRealtime';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({
  supabase: { channel: vi.fn(), removeChannel: vi.fn() },
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn() } }));

let handlers: Record<string, () => void>;
let statusCallback: (status: string, err?: Error) => void;
let channelMock: any;

beforeEach(() => {
  vi.useFakeTimers();
  handlers = {};
  channelMock = {
    on: vi.fn((_evt: string, filter: { table: string }, cb: () => void) => {
      handlers[filter.table] = cb;
      return channelMock;
    }),
    subscribe: vi.fn((cb: typeof statusCallback) => {
      statusCallback = cb;
      return channelMock;
    }),
  };
  vi.mocked(supabase.channel).mockReturnValue(channelMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useAgendaRealtime', () => {
  it('assina reservations, matches e challenges', () => {
    renderHook(() => useAgendaRealtime(vi.fn()));
    expect(Object.keys(handlers).sort()).toEqual([...AGENDA_REALTIME_TABLES].sort());
  });

  it('chama onChange quando alguém cria, entra ou sai de uma reserva', () => {
    const onChange = vi.fn();
    renderHook(() => useAgendaRealtime(onChange));

    handlers.reservations();
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('junta uma rajada de eventos numa única releitura', () => {
    const onChange = vi.fn();
    renderHook(() => useAgendaRealtime(onChange));

    handlers.reservations();
    handlers.reservations();
    handlers.challenges();
    handlers.matches();
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('não relê na primeira conexão, mas relê quando o canal reconecta', () => {
    const onChange = vi.fn();
    renderHook(() => useAgendaRealtime(onChange));

    statusCallback('SUBSCRIBED');
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    expect(onChange).not.toHaveBeenCalled();

    statusCallback('SUBSCRIBED');
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('relê quando a aba volta ao primeiro plano e quando a rede volta', () => {
    const onChange = vi.fn();
    renderHook(() => useAgendaRealtime(onChange));

    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ao desmontar remove o canal, os ouvintes e a releitura pendente', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useAgendaRealtime(onChange));

    handlers.reservations();
    unmount();
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(AGENDA_REALTIME_DEBOUNCE_MS);

    expect(onChange).not.toHaveBeenCalled();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channelMock);
  });
});
