import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Avatar, Empty } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { Conversation, Message } from '../types';
import { fmtShort } from '../utils/format';

/** Chat en tiempo real (Socket.io) con marca de hora y confirmación de lectura. */
export default function Chat() {
  const { user } = useAuth();
  const socket = useSocket();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const activeId = params.get('c');
  const active = conversations.find((c) => c.id === activeId) ?? null;

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get<{ conversations: Conversation[] }>('/chat/conversations');
      setConversations(data.conversations);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [toast]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const markRead = useCallback(() => {
    if (!activeId) return;
    if (socket?.connected) socket.emit('message:read', { conversation_id: activeId });
    else void api.post(`/chat/conversations/${activeId}/read`).catch(() => undefined);
    setConversations((cs) => cs.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c)));
  }, [activeId, socket]);

  // Historial de la conversación abierta
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    api
      .get<{ messages: Message[] }>(`/chat/conversations/${activeId}/messages`)
      .then((r) => {
        setMessages(r.data.messages);
        markRead();
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [activeId, markRead, toast]);

  // Eventos en tiempo real
  useEffect(() => {
    if (!socket) return;
    const onNew = (m: Message) => {
      if (m.conversation_id === activeId) {
        setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
        if (m.sender_id !== user?.id) markRead();
      }
      void loadConversations();
    };
    const onRead = (e: { conversation_id: string; message_ids: string[]; read_at: string }) => {
      if (e.conversation_id !== activeId) return;
      setMessages((ms) => ms.map((m) => (e.message_ids.includes(m.id) ? { ...m, read_at: e.read_at } : m)));
    };
    socket.on('message:new', onNew);
    socket.on('message:read', onRead);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:read', onRead);
    };
  }, [socket, activeId, user?.id, markRead, loadConversations]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !activeId) return;
    setText('');
    if (socket?.connected) {
      socket.emit('message:send', { conversation_id: activeId, body }, (ack: { ok: boolean; error?: string }) => {
        if (!ack.ok) toast.error(ack.error ?? 'No se pudo enviar.');
      });
    } else {
      try {
        const { data } = await api.post<{ message: Message }>(`/chat/conversations/${activeId}/messages`, { body });
        setMessages((ms) => [...ms, data.message]);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Mensajes</h1>
      </div>
      <div className="chat">
        <div className={`chat__list${activeId ? ' is-hidden' : ''}`}>
          {conversations.length === 0 && <Empty>No tiene conversaciones. Inicie una desde el perfil de un tutor.</Empty>}
          {conversations.map((c) => (
            <button key={c.id} className={`chat__item${c.id === activeId ? ' is-active' : ''}`} onClick={() => setParams({ c: c.id })}>
              <Avatar name={c.other_name} url={c.other_photo} />
              <span className="chat__item-text">
                <strong>{c.other_name}</strong>
                <small>{c.last_body ?? 'Sin mensajes'}</small>
              </span>
              {c.unread > 0 && <span className="badge-dot">{c.unread}</span>}
            </button>
          ))}
        </div>
        <div className={`chat__thread${activeId ? '' : ' is-hidden'}`}>
          {active ? (
            <>
              <div className="chat__head">
                <button className="btn btn--secondary btn--sm" onClick={() => setParams({})} aria-label="Volver">
                  ←
                </button>
                <Avatar name={active.other_name} url={active.other_photo} />
                {active.other_name}
                <span className="muted small" style={{ marginLeft: 'auto' }}>
                  {socket?.connected ? '● en línea' : '○ sin conexión en tiempo real'}
                </span>
              </div>
              <div className="chat__messages">
                {messages.map((m) =>
                  m.is_system ? (
                    <div key={m.id} className="bubble bubble--system">
                      {m.body}
                      <div className="bubble__meta">{fmtShort(m.created_at)}</div>
                    </div>
                  ) : (
                  <div key={m.id} className={`bubble${m.sender_id === user?.id ? ' bubble--mine' : ''}`}>
                    {m.body}
                    <div className="bubble__meta">
                      {fmtShort(m.created_at)}
                      {m.sender_id === user?.id && (m.read_at ? ' · ✓✓ leído' : ' · ✓ enviado')}
                    </div>
                  </div>
                  ),
                )}
                <div ref={bottom} />
              </div>
              <form className="chat__form" onSubmit={(e) => void send(e)}>
                <input type="text" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Escriba un mensaje…" aria-label="Mensaje" />
                <button className="btn" type="submit" disabled={!text.trim()}>
                  Enviar
                </button>
              </form>
            </>
          ) : (
            <Empty>Seleccione una conversación.</Empty>
          )}
        </div>
      </div>
    </div>
  );
}
