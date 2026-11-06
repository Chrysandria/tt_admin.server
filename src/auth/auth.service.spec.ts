import { Test, TestingModule } from '@nestjs/testing';
import { scryptSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = {
    user: {
      findFirst: vi.fn(),
    },
  };
  const jwtService = {
    signAsync: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('creates a short-lived access token without exposing the password', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = scryptSync('secret', salt, 64).toString('hex');
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      nom: 'User',
      profil: 'user',
      type: 'user',
      password: `scrypt$${salt}$${passwordHash}`,
    });
    jwtService.signAsync.mockResolvedValue('signed-token');

    const result = await service.login({
      email: 'user@example.com',
      password: 'secret',
    });

    expect(jwtService.signAsync).toHaveBeenCalledWith(
      {
        sub: 'user-1',
        email: 'user@example.com',
        profil: 'user',
        type: 'user',
      },
      { expiresIn: '1h' },
    );
    expect(result).toEqual({
      accessToken: 'signed-token',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        nom: 'User',
        profil: 'user',
        type: 'user',
      },
      stayConnected: false,
    });
  });

  it('uses a 30-day token when stayConnected is enabled', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = scryptSync('secret', salt, 64).toString('hex');
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      nom: 'User',
      profil: 'user',
      type: 'user',
      password: `scrypt$${salt}$${passwordHash}`,
    });
    jwtService.signAsync.mockResolvedValue('signed-token');

    await service.login({
      email: 'user@example.com',
      password: 'secret',
      stayConnected: true,
    });

    expect(jwtService.signAsync).toHaveBeenCalledWith(expect.any(Object), {
      expiresIn: '30d',
    });
  });

  it('rejects invalid credentials', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'secret' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
