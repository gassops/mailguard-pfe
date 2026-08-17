/**
 * Tests unitaires — Module 3 : SMTP Mailbox Check
 * On mock le module net pour simuler les réponses du serveur SMTP
 */

jest.mock('net');
const net = require('net');
const { analyze } = require('../../src/modules/smtp');

function createMockSocket(responses) {
  const EventEmitter = require('events');
  const socket = new EventEmitter();

  socket.write = jest.fn((cmd) => {
    const response = responses.shift();
    if (response) {
      process.nextTick(() => socket.emit('data', response));
    }
  });
  socket.setTimeout = jest.fn();
  socket.destroy   = jest.fn();
  socket.connect   = jest.fn((port, host) => {
    const banner = responses.shift();
    if (banner) process.nextTick(() => socket.emit('data', banner));
  });

  return socket;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('analyze() — SMTP Mailbox Check', () => {
  test('retourne UNKNOWN si aucun MX fourni', async () => {
    const result = await analyze('user@example.com', null);

    expect(result.status).toBe('UNKNOWN');
    expect(result.score).toBe(0);
    expect(result.exists).toBeNull();
  });

  test('retourne EXISTS (score=0) si le serveur répond 250 au RCPT TO', async () => {
    const mockSocket = createMockSocket([
      '220 mail.example.com ESMTP\r\n',
      '250 OK\r\n',
      '250 OK\r\n',
      '250 OK\r\n',
    ]);
    net.Socket.mockImplementation(() => mockSocket);

    const result = await analyze('user@example.com', 'mail.example.com');

    expect(result.status).toBe('EXISTS');
    expect(result.exists).toBe(true);
    expect(result.score).toBe(0);
  });

  test('retourne NOT_EXISTS (score=15) si le serveur répond 550 au RCPT TO', async () => {
    const mockSocket = createMockSocket([
      '220 mail.example.com ESMTP\r\n',
      '250 OK\r\n',
      '250 OK\r\n',
      '550 No such user\r\n',
    ]);
    net.Socket.mockImplementation(() => mockSocket);

    const result = await analyze('ghost@example.com', 'mail.example.com');

    expect(result.status).toBe('NOT_EXISTS');
    expect(result.exists).toBe(false);
    expect(result.score).toBe(15);
  });

  test('retourne UNKNOWN si timeout SMTP', async () => {
    const EventEmitter = require('events');
    const socket = new EventEmitter();
    socket.write     = jest.fn();
    socket.setTimeout = jest.fn((ms) => process.nextTick(() => socket.emit('timeout')));
    socket.destroy   = jest.fn();
    socket.connect   = jest.fn();
    net.Socket.mockImplementation(() => socket);

    const result = await analyze('user@example.com', 'slow.example.com');

    expect(result.status).toBe('UNKNOWN');
    expect(result.reasons[0]).toContain('Timeout');
  });

  test('retourne UNKNOWN si erreur de connexion', async () => {
    const EventEmitter = require('events');
    const socket = new EventEmitter();
    socket.write     = jest.fn();
    socket.setTimeout = jest.fn();
    socket.destroy   = jest.fn();
    socket.connect   = jest.fn(() =>
      process.nextTick(() => socket.emit('error', new Error('ECONNREFUSED')))
    );
    net.Socket.mockImplementation(() => socket);

    const result = await analyze('user@example.com', 'closed.example.com');

    expect(result.status).toBe('UNKNOWN');
    expect(result.reasons[0]).toContain('ECONNREFUSED');
  });
});
