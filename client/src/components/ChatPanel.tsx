import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../services/api';
import { useSubmit, useVisiblePolling } from '../hooks/useApi';
import { errorMessage } from './Feedback';

interface Msg {
  id: string;
  mine: boolean;
  body: string;
  createdAt: string;
}

interface Labels {
  placeholder: string;
  send: string;
  you: string;
  other: string;
  ended: string;
}

/** Text chat for a consultation. Polls lightly (5s, only while visible) instead of a socket. */
export function ChatPanel({
  consultationId,
  open,
  labels,
  formatTime,
  t,
}: {
  consultationId: string;
  open: boolean;
  labels: Labels;
  formatTime: (d: string) => string;
  t?: (k: string) => string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const lastRef = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchNew = useCallback(async () => {
    try {
      const q = lastRef.current ? `?after=${encodeURIComponent(lastRef.current)}` : '';
      const r = await api.get<{ messages: Msg[] }>(`/consultations/${consultationId}/messages${q}`);
      if (r.messages.length) {
        lastRef.current = r.messages[r.messages.length - 1].createdAt;
        setMessages((m) => {
          const seen = new Set(m.map((x) => x.id));
          return [...m, ...r.messages.filter((x) => !seen.has(x.id))];
        });
      }
    } catch {
      /* network banner already informs the user */
    }
  }, [consultationId]);

  useEffect(() => {
    lastRef.current = undefined;
    setMessages([]);
    void fetchNew();
  }, [fetchNew]);
  useVisiblePolling(fetchNew, 5000, open);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    void run(async () => {
      try {
        setErr('');
        const r = await api.post<{ message: Msg }>(`/consultations/${consultationId}/messages`, { body });
        setText('');
        setMessages((m) => (m.some((x) => x.id === r.message.id) ? m : [...m, r.message]));
      } catch (e2) {
        setErr(errorMessage(e2, t));
      }
    });
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.mine ? 'mine' : 'theirs'}`}>
            <span className="chat-who">{m.mine ? labels.you : labels.other}</span>
            <span className="chat-body">{m.body}</span>
            <span className="chat-time">{formatTime(m.createdAt)}</span>
          </div>
        ))}
      </div>
      {open ? (
        <form className="chat-form" onSubmit={send}>
          <label className="sr-only" htmlFor="chat-input">
            {labels.placeholder}
          </label>
          <input id="chat-input" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={labels.placeholder} autoComplete="off" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {labels.send}
          </button>
        </form>
      ) : (
        <p className="empty">{labels.ended}</p>
      )}
      {err && <p className="field-error" role="alert">{err}</p>}
    </div>
  );
}
