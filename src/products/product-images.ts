import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const UPLOAD_DIRECTORY = resolve(process.cwd(), 'uploads', 'products');
const PUBLIC_IMAGE_PREFIX = '/uploads/products/';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function getImageExtension(buffer: Buffer): string {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  throw new BadRequestException('Image must be a valid JPEG, PNG or WebP file');
}

export async function saveProductImage(
  file?: Express.Multer.File,
): Promise<string | null> {
  if (!file) return null;
  if (file.size > MAX_IMAGE_SIZE) {
    throw new BadRequestException('Product images must be 5 MB or smaller');
  }

  const extension = getImageExtension(file.buffer);
  const filename = `${randomUUID()}.${extension}`;
  await mkdir(UPLOAD_DIRECTORY, { recursive: true });
  await writeFile(resolve(UPLOAD_DIRECTORY, filename), file.buffer, {
    flag: 'wx',
  });
  return `${PUBLIC_IMAGE_PREFIX}${filename}`;
}

export async function removeProductImage(imageUrl: string | null | undefined) {
  if (!imageUrl?.startsWith(PUBLIC_IMAGE_PREFIX)) return;
  const filename = imageUrl.slice(PUBLIC_IMAGE_PREFIX.length);
  if (!filename || filename !== basename(filename)) {
    return;
  }

  try {
    await unlink(resolve(UPLOAD_DIRECTORY, filename));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
}
