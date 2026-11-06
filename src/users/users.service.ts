import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, scrypt } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User } from './entities/user.entity.js';

const USER_SELECT = {
  id: true,
  email: true,
  nom: true,
  profil: true,
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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    if (
      typeof createUserDto.email !== 'string' ||
      !createUserDto.email.trim() ||
      typeof createUserDto.nom !== 'string' ||
      !createUserDto.nom.trim() ||
      typeof createUserDto.profil !== 'string' ||
      !createUserDto.profil.trim() ||
      typeof createUserDto.password !== 'string' ||
      !createUserDto.password
    ) {
      throw new BadRequestException(
        'email, nom, profil and password are required',
      );
    }

    try {
      return await this.prisma.user.create({
        data: {
          id: randomBytes(16).toString('hex'),
          email: createUserDto.email,
          nom: createUserDto.nom,
          profil: createUserDto.profil,
          password: await hashPassword(createUserDto.password),
        },
        select: USER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
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
      (typeof updateUserDto.profil !== 'string' || !updateUserDto.profil.trim())
    ) {
      throw new BadRequestException('profil cannot be empty');
    }
    if (
      updateUserDto.password !== undefined &&
      (typeof updateUserDto.password !== 'string' ||
        updateUserDto.password.length === 0)
    ) {
      throw new BadRequestException('password cannot be empty');
    }

    const { password, ...userData } = updateUserDto;
    const data = {
      ...userData,
      ...(password === undefined
        ? {}
        : { password: await hashPassword(password) }),
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
}
