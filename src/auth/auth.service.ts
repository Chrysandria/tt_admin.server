import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { promisify } from 'node:util';
import {
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { MailService } from '../mail/mail.service.js';

const scrypt = promisify(scryptCallback);

export interface AuthenticatedUser {
  id: string;
  email: string;
  nom: string;
  profil: string;
  type: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async login(loginDto: LoginDto) {
    if (
      !loginDto ||
      typeof loginDto.email !== 'string' ||
      typeof loginDto.password !== 'string' ||
      (typeof loginDto.stayConnected !== 'undefined' &&
        typeof loginDto.stayConnected !== 'boolean')
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: loginDto.email, deletedAt: null },
      select: {
        id: true,
        email: true,
        nom: true,
        profil: true,
        type: true,
        password: true,
      },
    });

    if (
      !user ||
      !(await this.verifyPassword(loginDto.password, user.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      nom: user.nom,
      profil: user.profil,
      type: user.type,
    };
    const expiresIn = loginDto.stayConnected ? '30d' : '1h';
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        profil: user.profil,
        type: user.type,
      },
      { expiresIn },
    );

    return {
      accessToken,
      user: authenticatedUser,
      stayConnected: !!loginDto.stayConnected,
    };
  }

  async validateUser(userId: string): Promise<AuthenticatedUser | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        nom: true,
        profil: true,
        type: true,
      },
    });
  }

  async requestPasswordChange(
    userId: string,
    currentPassword: unknown,
    newPassword: unknown,
  ): Promise<void> {
    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      newPassword.length < 8 ||
      newPassword.length > 128 ||
      newPassword === currentPassword
    ) {
      throw new BadRequestException(
        'Choisissez un nouveau mot de passe différent, entre 8 et 128 caractères.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { password: true, email: true, nom: true },
    });
    if (!user || !(await this.verifyPassword(currentPassword, user.password))) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otpHash = this.hashOtp(userId, otp);
    const newPasswordHash = await this.hashPassword(newPassword);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.prisma.passwordChangeChallenge.upsert({
      where: { userId },
      create: {
        userId,
        otpHash,
        currentPasswordHash: user.password,
        newPasswordHash,
        expiresAt,
        attempts: 0,
      },
      update: {
        otpHash,
        currentPasswordHash: user.password,
        newPasswordHash,
        expiresAt,
        attempts: 0,
      },
    });

    try {
      await this.mailService.sendPasswordChangeOtp(user.email, user.nom, otp);
    } catch (error) {
      await this.prisma.passwordChangeChallenge.deleteMany({
        where: { userId, otpHash },
      });
      throw error;
    }
  }

  async confirmPasswordChange(userId: string, otp: unknown): Promise<void> {
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      throw new BadRequestException('Saisissez le code à 6 chiffres reçu par e-mail.');
    }

    const challenge = await this.prisma.passwordChangeChallenge.findUnique({
      where: { userId },
    });
    if (!challenge || challenge.expiresAt <= new Date()) {
      if (challenge) {
        await this.prisma.passwordChangeChallenge.deleteMany({
          where: { userId, otpHash: challenge.otpHash },
        });
      }
      throw new UnauthorizedException('Le code est invalide ou expiré.');
    }
    if (challenge.attempts >= 5) {
      throw new UnauthorizedException(
        'Trop de tentatives. Demandez un nouveau code de confirmation.',
      );
    }

    const receivedHash = Buffer.from(this.hashOtp(userId, otp), 'hex');
    const expectedHash = Buffer.from(challenge.otpHash, 'hex');
    if (
      receivedHash.length !== expectedHash.length ||
      !timingSafeEqual(receivedHash, expectedHash)
    ) {
      await this.prisma.passwordChangeChallenge.updateMany({
        where: {
          userId,
          otpHash: challenge.otpHash,
          attempts: { lt: 5 },
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Le code est invalide ou expiré.');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordChangeChallenge.deleteMany({
        where: {
          userId,
          otpHash: challenge.otpHash,
          attempts: { lt: 5 },
          expiresAt: { gt: new Date() },
        },
      });
      if (consumed.count !== 1) return false;
      const result = await transaction.user.updateMany({
        where: {
          id: userId,
          deletedAt: null,
          password: challenge.currentPasswordHash,
        },
        data: { password: challenge.newPasswordHash },
      });
      return result.count === 1;
    });
    if (!updated) {
      throw new ConflictException(
        'Le code a expiré ou a déjà été utilisé. Demandez-en un nouveau.',
      );
    }
  }

  private async verifyPassword(password: string, storedHash: string) {
    const [algorithm, salt, digest] = storedHash.split('$');
    if (
      algorithm !== 'scrypt' ||
      !/^[a-f0-9]{32}$/i.test(salt ?? '') ||
      !/^[a-f0-9]{128}$/i.test(digest ?? '')
    ) {
      return false;
    }

    const expected = Buffer.from(digest, 'hex');
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return timingSafeEqual(actual, expected);
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  private hashOtp(userId: string, otp: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) {
      throw new ServiceUnavailableException(
        'La configuration de sécurité du serveur est invalide.',
      );
    }
    return createHmac('sha256', secret)
      .update(`${userId}:${otp}`)
      .digest('hex');
  }
}
