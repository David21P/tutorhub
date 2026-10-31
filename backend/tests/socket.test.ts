import http from 'http';
import { AddressInfo } from 'net';
import { io as connect, Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { attachSockets } from '../src/sockets/chat';
import { app, auth, login, onboardStudent, resetDb, setupTutor } from './helpers';

let server: http.Server;
let url: string;
let tutorToken: string;
let studentToken: string;
let tutorId: string;

const open = (token: string | null): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => {
      s.close();
      reject(err);
    });
  });

const once = <T>(s: Socket, event: string): Promise<T> => new Promise((resolve) => s.once(event, resolve));

beforeAll(async () => {
  await resetDb();
  const admin = await login('admin@test.com');
  const t = await setupTutor(admin, 'tutor@test.com');
  tutorToken = t.token;
  tutorId = t.id;
  studentToken = await onboardStudent('est@test.com');
  server = http.createServer(app);
  attachSockets(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await pool.end();
});

describe('Socket.io', () => {
  it('rechaza conexiones sin token o con token inválido', async () => {
    await expect(open(null)).rejects.toThrow('TOKEN_REQUIRED');
    await expect(open('basura')).rejects.toThrow('TOKEN_INVALID');
  });

  it('entrega mensajes en tiempo real con fecha/hora y confirmación de lectura', async () => {
    const conv = await request(app).post('/api/chat/conversations').set(auth(studentToken)).send({ tutor_id: tutorId });
    const conversationId = conv.body.id as string;
    const student = await open(studentToken);
    const tutor = await open(tutorToken);

    const received = once<{ body: string; created_at: string; sender_id: string; read_at: string | null }>(tutor, 'message:new');
    const ack = await new Promise<{ ok: boolean }>((resolve) =>
      student.emit('message:send', { conversation_id: conversationId, body: 'Hola profe' }, resolve),
    );
    expect(ack.ok).toBe(true);
    const msg = await received;
    expect(msg.body).toBe('Hola profe');
    expect(Number.isNaN(Date.parse(msg.created_at))).toBe(false);
    expect(msg.read_at).toBeNull();

    const receipt = once<{ message_ids: string[]; read_at: string }>(student, 'message:read');
    tutor.emit('message:read', { conversation_id: conversationId });
    const r = await receipt;
    expect(r.message_ids).toHaveLength(1);
    expect(Number.isNaN(Date.parse(r.read_at))).toBe(false);

    const bad = await new Promise<{ ok: boolean }>((resolve) =>
      student.emit('message:send', { conversation_id: '00000000-0000-0000-0000-000000000000', body: 'x' }, resolve),
    );
    expect(bad.ok).toBe(false);
    student.close();
    tutor.close();
  });
});
