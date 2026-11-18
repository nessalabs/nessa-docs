// The reader's side of the port to the content script: each question gets an
// id and waits for its answer.

import type { Answer, ListedEntry, ReadAnswer, ReaderEvent, Request } from './protocol';

export interface RepoPort {
  list(path: string): Promise<readonly ListedEntry[] | null>;
  read(path: string, maxBytes: number): Promise<ReadAnswer>;
  tell(event: ReaderEvent): void;
}

type Question = { op: 'list'; path: string } | { op: 'read'; path: string; maxBytes: number };

export function portClient(port: MessagePort, onOther: (message: unknown) => void): RepoPort {
  let next = 1;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  port.onmessage = (event) => {
    const message = event.data as Partial<Answer> | null;
    if (message && typeof message.id === 'number' && typeof message.ok === 'boolean') {
      const pending = waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id);
      if (message.ok) pending.resolve((message as { value: unknown }).value);
      else pending.reject(new Error((message as { message?: string }).message ?? 'GitHub did not answer.'));
      return;
    }
    onOther(event.data);
  };
  const ask = (question: Question) => new Promise<unknown>((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    port.postMessage({ id, ...question } satisfies Request);
  });
  return {
    list: (path) => ask({ op: 'list', path }) as Promise<readonly ListedEntry[] | null>,
    read: (path, maxBytes) => ask({ op: 'read', path, maxBytes }) as Promise<ReadAnswer>,
    tell: (event) => port.postMessage(event),
  };
}
