import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto, imageUrl: string | null = null) {
    this.validateQuantity(createProductDto.initial, 'initial');
    if (
      typeof createProductDto.nom !== 'string' ||
      !createProductDto.nom.trim()
    ) {
      throw new BadRequestException('Product name is required');
    }
    if (typeof createProductDto.prix !== 'string') {
      throw new BadRequestException('Product price must be a string');
    }
    const keywords = this.normalizeKeywords(createProductDto.keywords);

    return this.prisma.product.create({
      data: {
        id: randomUUID(),
        nom: createProductDto.nom,
        keywords,
        prix: createProductDto.prix ?? '',
        imageUrl,
        initial: createProductDto.initial,
        available: createProductDto.initial,
      },
    });
  }

  findAll() {
    return this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    if (updateProductDto.available !== undefined) {
      this.validateQuantity(updateProductDto.available, 'available');
    }
    if (updateProductDto.initial !== undefined) {
      this.validateQuantity(updateProductDto.initial, 'initial');
    }
    if (
      updateProductDto.nom !== undefined &&
      (typeof updateProductDto.nom !== 'string' || !updateProductDto.nom.trim())
    ) {
      throw new BadRequestException('Product name cannot be empty');
    }
    if (
      updateProductDto.prix !== undefined &&
      typeof updateProductDto.prix !== 'string'
    ) {
      throw new BadRequestException('Product price must be a string');
    }
    const keywords =
      updateProductDto.keywords === undefined
        ? undefined
        : this.normalizeKeywords(updateProductDto.keywords);

    const result = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: {
        ...(updateProductDto.nom === undefined
          ? {}
          : { nom: updateProductDto.nom }),
        ...(updateProductDto.prix === undefined
          ? {}
          : { prix: updateProductDto.prix }),
        ...(updateProductDto.initial === undefined
          ? {}
          : { initial: updateProductDto.initial }),
        ...(updateProductDto.available === undefined
          ? {}
          : { available: updateProductDto.available }),
        ...(updateProductDto.imageUrl === undefined
          ? {}
          : { imageUrl: updateProductDto.imageUrl }),
        ...(keywords === undefined ? {} : { keywords }),
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const deletedAt = new Date();
    const result = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return this.prisma.product.findUniqueOrThrow({ where: { id } });
  }

  private validateQuantity(value: number, field: string) {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }
  }

  private normalizeKeywords(keywords: string[] | undefined) {
    if (keywords === undefined) return [];
    if (!Array.isArray(keywords) || keywords.length > 30) {
      throw new BadRequestException(
        'Product keywords must be a list of at most 30 entries',
      );
    }

    const normalized = new Map<string, string>();
    for (const keyword of keywords) {
      if (typeof keyword !== 'string') {
        throw new BadRequestException('Each product keyword must be text');
      }
      const trimmed = keyword.trim();
      if (!trimmed) continue;
      if (trimmed.length > 80) {
        throw new BadRequestException(
          'Product keywords cannot exceed 80 characters',
        );
      }
      const key = trimmed
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('fr-FR');
      if (!normalized.has(key)) normalized.set(key, trimmed);
    }
    return [...normalized.values()];
  }
}
