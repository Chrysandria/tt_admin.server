import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const prisma = {
    user: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('stores a derived password hash and never selects it in responses', async () => {
    prisma.user.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'user-1', email: data.email }),
    );

    await service.create({
      email: 'user@example.com',
      nom: 'User',
      profil: 'manager',
      password: 'secret',
    });

    const [{ data, select }] = prisma.user.create.mock.calls[0];
    expect(data.password).not.toBe('secret');
    expect(data.password).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(select).not.toHaveProperty('password');
  });

  it('excludes soft-deleted users from the collection', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});
