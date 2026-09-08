import { describe, expect, it, vi } from 'vitest';
import { createConsumerRequestGate } from './consumers-page.tsx';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('consumer requests', () => {
  it('keeps the latest search or consumer detail when an older request completes last', async () => {
    const gate = createConsumerRequestGate<string>();
    const old = deferred<string>(); const current = deferred<string>();
    const success = vi.fn(); const failure = vi.fn();
    const first = gate.run(() => old.promise, success, failure);
    const second = gate.run(() => current.promise, success, failure);
    current.resolve('selected consumer'); await second;
    old.resolve('previous consumer'); await first;
    expect(success.mock.calls).toEqual([['selected consumer']]);
    expect(failure).not.toHaveBeenCalled();
  });
  it('ignores stale failures and never hands server error objects to the display', async () => {
    const gate = createConsumerRequestGate<string>(); const old = deferred<string>();
    const success = vi.fn(); const failure = vi.fn();
    const first = gate.run(() => old.promise, success, failure);
    await gate.run(async () => 'latest', success, failure);
    old.reject({ phone: 'sensitive upstream data' }); await first;
    expect(failure).not.toHaveBeenCalled();
    await gate.run(async () => { throw new Error('private upstream details'); }, success, failure);
    expect(failure.mock.calls).toEqual([[]]);
  });
  it('does not update a closed or unmounted consumer detail and permits a clean retry', async () => {
    const gate = createConsumerRequestGate<string>(); const pending = deferred<string>();
    const success = vi.fn(); const failure = vi.fn();
    const first = gate.run(() => pending.promise, success, failure);
    gate.cancel(); pending.resolve('closed consumer'); await first;
    expect(success).not.toHaveBeenCalled();
    await gate.run(async () => 'retry result', success, failure);
    expect(success).toHaveBeenCalledExactlyOnceWith('retry result');
  });
});
