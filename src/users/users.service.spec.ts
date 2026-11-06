import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
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
      deleteMany: vi.fn(),
    },
  };
  const mailService = { sendInitialPassword: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates the selected account type and mails a generated password without returning it', async () => {
    prisma.user.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'user-1',
        email: data.email,
        nom: data.nom,
        profil: data.profil,
        type: data.type,
      }),
    );
    mailService.sendInitialPassword.mockResolvedValue(undefined);

    const user = await service.create({
      email: ' User@Example.com ',
      type: 'admin',
    });

    const [{ data, select }] = prisma.user.create.mock.calls[0];
    expect(data.password).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(select).not.toHaveProperty('password');
    expect(data).toMatchObject({
      email: 'user@example.com',
      nom: 'User',
      profil: 'admin',
      type: 'admin',
    });
    expect(mailService.sendInitialPassword).toHaveBeenCalledWith(
      'user@example.com',
      'User',
      expect.any(String),
      'admin',
    );
    expect(user).not.toHaveProperty('password');
    expect(user.email).toBe('user@example.com');
  });

  it('removes the account when the invitation email cannot be sent', async () => {
    prisma.user.create.mockResolvedValue({ id: 'user-1' });
    prisma.user.deleteMany.mockResolvedValue({ count: 1 });
    mailService.sendInitialPassword.mockRejectedValue(new Error('SMTP failed'));

    await expect(
      service.create({ email: 'user@example.com', type: 'user' }),
    ).rejects.toThrow('courriel de bienvenue');
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('rejects account creation without a supported account type', async () => {
    await expect(
      service.create({ email: 'user@example.com', type: undefined }),
    ).rejects.toThrow('type must be admin or user');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('excludes soft-deleted users from the collection', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('updates the account type and keeps the legacy profile in sync', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      nom: 'User',
      profil: 'admin',
      type: 'admin',
    });

    await service.update('user-1', { type: 'admin' });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', deletedAt: null },
      data: { profil: 'admin', type: 'admin' },
    });
  });

  it('rejects account types outside admin and user', async () => {
    await expect(
      service.update('user-1', { profil: 'manager' }),
    ).rejects.toThrow('type must be admin or user');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
