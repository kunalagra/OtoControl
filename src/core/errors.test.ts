import { describe, expect, it } from 'vitest';

import { describeError } from './errors';

describe('describeError', () => {
  it('turns a picker-cancelled NotFoundError into copy the UI can show', () => {
    expect(describeError(new DOMException('no port selected', 'NotFoundError'))).toBe(
      'No device was selected. Make sure it is powered on and connected as an audio device.',
    );
  });

  it('falls back to the message of any other Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('stringifies whatever was thrown when it is not an Error at all', () => {
    expect(describeError('boom')).toBe('boom');
  });
});
