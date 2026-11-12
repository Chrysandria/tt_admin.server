import { Test, TestingModule } from '@nestjs/testing';
import { createHmac, scryptSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = {
    user: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    passwordChangeChallenge: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const jwtService = {
    signAsync: vi.fn(),
  };
  const mailService = { sendPasswordChangeOtp: vi.fn() };
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-bytes';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
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

  it('sends an OTP after validating the current password and saves a pending hash', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = scryptSync('current-password', salt, 64).toString('hex');
    prisma.user.findFirst.mockResolvedValue({
      password: `scrypt$${salt}$${passwordHash}`,
      email: 'user@example.com',
      nom: 'User',
    });
    prisma.passwordChangeChallenge.upsert.mockResolvedValue({});
    mailService.sendPasswordChangeOtp.mockResolvedValue(undefined);

    await service.requestPasswordChange(
      'user-1',
      'current-password',
      'a-new-password',
    );

    expect(mailService.sendPasswordChangeOtp).toHaveBeenCalledWith(
      'user@example.com',
      'User',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(prisma.passwordChangeChallenge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          otpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          currentPasswordHash: `scrypt$${salt}$${passwordHash}`,
          newPasswordHash: expect.stringMatching(
            /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/,
          ),
          attempts: 0,
        }),
      }),
    );
  });

  it('does not send an OTP when the current password is incorrect', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = scryptSync('correct-password', salt, 64).toString('hex');
    prisma.user.findFirst.mockResolvedValue({
      password: `scrypt$${salt}$${passwordHash}`,
    });

    await expect(
      service.requestPasswordChange(
        'user-1',
        'incorrect-password',
        'new-password',
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(prisma.passwordChangeChallenge.upsert).not.toHaveBeenCalled();
    expect(mailService.sendPasswordChangeOtp).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than eight characters', async () => {
    await expect(
      service.requestPasswordChange('user-1', 'current-password', 'short'),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('changes the password only after consuming a valid OTP', async () => {
    const otp = '042681';
    const otpHash = createHmac('sha256', process.env.JWT_SECRET!)
      .update(`user-1:${otp}`)
      .digest('hex');
    const newPasswordHash =
      `scrypt$0123456789abcdef0123456789abcdef$${'a'.repeat(128)}`;
    prisma.passwordChangeChallenge.findUnique.mockResolvedValue({
      userId: 'user-1',
      otpHash,
      currentPasswordHash: 'old-password-hash',
      newPasswordHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const transaction = {
      passwordChangeChallenge: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(transaction));

    await expect(
      service.confirmPasswordChange('user-1', otp),
    ).resolves.toBeUndefined();

    expect(transaction.passwordChangeChallenge.deleteMany).toHaveBeenCalled();
    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        deletedAt: null,
        password: 'old-password-hash',
      },
      data: { password: newPasswordHash },
    });
  });

  it('counts incorrect OTP attempts and does not change the password', async () => {
    const storedOtpHash = createHmac('sha256', process.env.JWT_SECRET!)
      .update('user-1:123456')
      .digest('hex');
    prisma.passwordChangeChallenge.findUnique.mockResolvedValue({
      userId: 'user-1',
      otpHash: storedOtpHash,
      newPasswordHash: 'pending-hash',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.confirmPasswordChange('user-1', '999999'),
    ).rejects.toMatchObject({ status: 401 });
    expect(prisma.passwordChangeChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          attempts: { lt: 5 },
        }),
        data: { attempts: { increment: 1 } },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
