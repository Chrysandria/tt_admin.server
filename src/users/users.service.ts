import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, scrypt } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { UserType } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User } from './entities/user.entity.js';

const USER_SELECT = {
  id: true,
  email: true,
  nom: true,
  profil: true,
  type: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`scrypt$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

function parseUserType(value: unknown): UserType {
  if (value === 'admin' || value === 'user') return value;
  throw new BadRequestException('type must be admin or user');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    if (
      !createUserDto ||
      typeof createUserDto.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createUserDto.email.trim())
    ) {
      throw new BadRequestException('A valid email address is required');
    }

    const userType = parseUserType(createUserDto.type);
    const email = createUserDto.email.trim().toLowerCase();
    const name = this.getNameFromEmail(email);
    const temporaryPassword = randomBytes(24).toString('base64url');
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          id: randomBytes(16).toString('hex'),
          email,
          nom: name,
          profil: userType,
          type: userType,
          password: await hashPassword(temporaryPassword),
        },
        select: USER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }

    try {
      await this.mailService.sendInitialPassword(
        email,
        name,
        temporaryPassword,
        userType,
      );
    } catch (error) {
      await this.prisma.user.deleteMany({ where: { id: user.id } });
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Le compte n’a pas pu être créé car son courriel de bienvenue n’a pas été envoyé.',
      );
    }

    return user;
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    if (
      updateUserDto.email !== undefined &&
      (typeof updateUserDto.email !== 'string' || !updateUserDto.email.trim())
    ) {
      throw new BadRequestException('email cannot be empty');
    }
    if (
      updateUserDto.nom !== undefined &&
      (typeof updateUserDto.nom !== 'string' || !updateUserDto.nom.trim())
    ) {
      throw new BadRequestException('nom cannot be empty');
    }
    if (
      updateUserDto.profil !== undefined &&
      updateUserDto.type !== undefined &&
      updateUserDto.profil !== updateUserDto.type
    ) {
      throw new BadRequestException('profil and type must match');
    }
    const accountType = updateUserDto.type ?? updateUserDto.profil;
    const userType =
      accountType === undefined ? undefined : parseUserType(accountType);
    if (
      updateUserDto.password !== undefined &&
      (typeof updateUserDto.password !== 'string' ||
        updateUserDto.password.length === 0)
    ) {
      throw new BadRequestException('password cannot be empty');
    }

    const data = {
      ...(updateUserDto.email === undefined
        ? {}
        : { email: updateUserDto.email }),
      ...(updateUserDto.nom === undefined ? {} : { nom: updateUserDto.nom }),
      ...(userType === undefined ? {} : { profil: userType, type: userType }),
      ...(updateUserDto.password === undefined
        ? {}
        : { password: await hashPassword(updateUserDto.password) }),
    };
    let result: { count: number };
    try {
      result = await this.prisma.user.updateMany({
        where: { id, deletedAt: null },
        data,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
    if (result.count === 0) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException(`User ${id} not found`);
    }
    const deletedUser = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!deletedUser) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return deletedUser;
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Email or profile already exists');
    }
    throw error;
  }

  private getNameFromEmail(email: string) {
    const localPart = email.split('@')[0] ?? email;
    const name = localPart
      .replace(/[._+-]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
    return name || email;
  }
}
