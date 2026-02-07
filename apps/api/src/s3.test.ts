import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { deleteObject } from './s3.js';

describe('s3', () => {
  it('deleteObject sends DeleteObjectCommand', async () => {
    const send = vi.fn().mockResolvedValue({});
    const s3 = { send } as any;

    await deleteObject({ s3, bucket: 'b', key: 'k' });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0];
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect((cmd as any).input).toMatchObject({ Bucket: 'b', Key: 'k' });
  });

  it('deleteObject treats NotFound as success', async () => {
    const err: any = new Error('not found');
    err.$metadata = { httpStatusCode: 404 };
    err.name = 'NoSuchKey';

    const send = vi.fn().mockRejectedValue(err);
    const s3 = { send } as any;

    await expect(deleteObject({ s3, bucket: 'b', key: 'k' })).resolves.toBeUndefined();
  });
});
