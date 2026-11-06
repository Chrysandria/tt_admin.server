import { readFile } from 'node:fs/promises';
import { removeProductImage, saveProductImage } from './product-images.js';

describe('product image storage', () => {
  it('stores image bytes on disk and returns only a relative URL', async () => {
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=',
      'base64',
    );
    const url = await saveProductImage({
      buffer,
      size: buffer.length,
    } as Express.Multer.File);

    expect(url).toMatch(/^\/uploads\/products\/[a-f0-9-]+\.png$/);
    expect(await readFile(`.${url}`)).toEqual(buffer);
    await removeProductImage(url);
  });

  it('rejects unsupported image contents', async () => {
    await expect(
      saveProductImage({
        buffer: Buffer.from('not an image'),
        size: 12,
      } as Express.Multer.File),
    ).rejects.toThrow('valid JPEG, PNG or WebP');
  });
});
