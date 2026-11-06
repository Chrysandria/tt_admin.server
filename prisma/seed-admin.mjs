import 'dotenv/config';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${digest.toString('hex')}`;
}

async function seedAdmin() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The test admin seeder cannot run in production');
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const connectionString = process.env.DATABASE_URL;
  if (!email || !password || !connectionString) {
    throw new Error(
      'SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, and DATABASE_URL are required',
    );
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.user.upsert({
      where: { email },
      create: {
        id: randomBytes(16).toString('hex'),
        email,
        nom: 'Chryslin Andrianja',
        profil: 'admin',
        type: 'admin',
        password: await hashPassword(password),
      },
      update: {
        nom: 'Chryslin Andrianja',
        profil: 'admin',
        type: 'admin',
        password: await hashPassword(password),
        deletedAt: null,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

seedAdmin()
  .then(() => {
    console.log('Test administrator seeded successfully.');
  })
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Failed to seed test administrator.',
    );
    process.exitCode = 1;
  });
