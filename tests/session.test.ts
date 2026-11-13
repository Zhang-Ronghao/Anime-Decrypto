import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSession } from '../src/lib/session';

test('session startup reports connection failures and can recover after a timeout', async t => {
  const storedSessionId = '11111111-1111-4111-8111-111111111111';
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => storedSessionId },
  });

  try {
    await t.test('network errors have a useful service connection message', async child => {
      child.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
      await assert.rejects(ensureSession(), /无法连接服务/);
    });

    await t.test('failed HTTP responses do not establish a session', async child => {
      child.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
      await assert.rejects(ensureSession(), /匿名会话创建失败/);
    });

    for (const stalledStage of ['headers', 'body']) {
      await t.test(`stalled ${stalledStage} time out and retry keeps the existing identity`, async child => {
        child.mock.timers.enable({ apis: ['setTimeout'] });
        let requestSignal: AbortSignal | undefined;
        const fetchMock = child.mock.method(globalThis, 'fetch', async (_url, init) => {
          requestSignal = init.signal;
          const stalled = new Promise<never>((_resolve, reject) => {
            requestSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          });
          return stalledStage === 'headers' ? stalled : { ok: true, json: () => stalled };
        });
        const pending = ensureSession();
        const rejection = assert.rejects(pending, /连接超时/);
        assert.equal(requestSignal?.aborted, false);
        child.mock.timers.tick(10_000);
        await rejection;
        assert.equal(requestSignal?.aborted, true);

        fetchMock.mock.mockImplementation(async (url, init) => {
          assert.equal(new URL(String(url), 'http://localhost').searchParams.get('session'), storedSessionId);
          assert.equal(init.signal.aborted, false);
          return Response.json({ user: { id: storedSessionId } });
        });
        assert.deepEqual(await ensureSession(), { user: { id: storedSessionId } });
      });
    }
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
