import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { promisify } from 'node:util';
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';

const scrypt = promisify(scryptCallback);

export interface AuthenticatedUser {
  id: string;
  email: string;
  nom: string;
  profil: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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
    };
    const expiresIn = loginDto.stayConnected ? '30d' : '1h';
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, profil: user.profil },
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
      select: { id: true, email: true, nom: true, profil: true },
    });
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
}
