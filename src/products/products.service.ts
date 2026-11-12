import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateProductColorDto,
  CreateProductDto,
} from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto, imageUrl: string | null = null) {
    const colors = this.normalizeColors(createProductDto.colors);
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
    this.validateDescription(createProductDto.description);
    const keywords = this.normalizeKeywords(createProductDto.keywords);
    const initial = colors.length
      ? colors.reduce((total, color) => total + color.initial, 0)
      : createProductDto.initial;

    return this.prisma.product.create({
      data: {
        id: randomUUID(),
        nom: createProductDto.nom,
        description: createProductDto.description?.trim() ?? '',
        keywords,
        prix: createProductDto.prix ?? '',
        imageUrl,
        initial,
        available: initial,
        ...(colors.length
          ? {
              colors: {
                create: colors.map((color) => ({
                  id: randomUUID(),
                  name: color.name,
                  initial: color.initial,
                  available: color.initial,
                })),
              },
            }
          : {}),
      },
      include: { colors: true },
    });
  }

  findAll() {
    return this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { colors: true },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { colors: true },
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
    this.validateDescription(updateProductDto.description);
    const keywords =
      updateProductDto.keywords === undefined
        ? undefined
        : this.normalizeKeywords(updateProductDto.keywords);

    if (updateProductDto.colors !== undefined) {
      return this.updateColors(id, updateProductDto, keywords);
    }

    const result = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: {
        ...(updateProductDto.nom === undefined
          ? {}
          : { nom: updateProductDto.nom }),
        ...(updateProductDto.prix === undefined
          ? {}
          : { prix: updateProductDto.prix }),
        ...(updateProductDto.description === undefined
          ? {}
          : { description: updateProductDto.description.trim() }),
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

  async markFacebookPublished(id: string, facebookPostId: string) {
    const result = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: { facebookPostId, facebookPublishedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const updatedProduct = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { colors: true },
    });
    if (!updatedProduct) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return updatedProduct;
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

  private validateDescription(description: string | undefined) {
    if (
      description !== undefined &&
      (typeof description !== 'string' || description.length > 5000)
    ) {
      throw new BadRequestException(
        'Product description must be text with at most 5000 characters',
      );
    }
  }

  private normalizeColors(colors: CreateProductColorDto[] | undefined) {
    if (colors === undefined) return [];
    if (!Array.isArray(colors) || colors.length > 30) {
      throw new BadRequestException(
        'Product colors must be a list of at most 30 entries',
      );
    }
    const uniqueNames = new Set<string>();
    return colors.map((color) => {
      if (
        typeof color !== 'object' ||
        color === null ||
        typeof color.name !== 'string' ||
        !color.name.trim() ||
        color.name.trim().length > 50
      ) {
        throw new BadRequestException(
          'Each product color needs a name of at most 50 characters',
        );
      }
      this.validateQuantity(color.initial, 'color initial');
      const available = color.available ?? color.initial;
      this.validateQuantity(available, 'color available');
      if (available > color.initial) {
        throw new BadRequestException(
          'Available color stock cannot exceed its initial stock',
        );
      }
      const name = color.name.trim();
      const key = this.normalizeLookupKey(name);
      if (uniqueNames.has(key)) {
        throw new BadRequestException(
          'Product colors must have unique names',
        );
      }
      uniqueNames.add(key);
      return { name, initial: color.initial, available };
    });
  }

  private async updateColors(
    id: string,
    updateProductDto: UpdateProductDto,
    keywords: string[] | undefined,
  ) {
    const colors = this.normalizeColors(updateProductDto.colors);
    return this.prisma.$transaction(
      async (tx) => {
        const currentProduct = await tx.product.findFirst({
          where: { id, deletedAt: null },
          include: { colors: true },
        });
        if (!currentProduct) {
          throw new NotFoundException(`Product ${id} not found`);
        }

        const incomingNames = new Set(
          colors.map((color) => this.normalizeLookupKey(color.name)),
        );
        const removedColors = currentProduct.colors.filter(
          (color) => !incomingNames.has(this.normalizeLookupKey(color.name)),
        );
        if (removedColors.length > 0) {
          const usedColor = await tx.orderItem.findFirst({
            where: {
              productColorId: { in: removedColors.map((color) => color.id) },
            },
            select: { id: true },
          });
          if (usedColor) {
            throw new BadRequestException(
              'A color used by an order cannot be removed',
            );
          }
          await tx.productColor.deleteMany({
            where: { id: { in: removedColors.map((color) => color.id) } },
          });
        }

        const nextColors = [];
        for (const color of colors) {
          const existingColor = currentProduct.colors.find(
            (current) =>
              this.normalizeLookupKey(current.name) ===
              this.normalizeLookupKey(color.name),
          );
          const available =
            updateProductDto.colors?.find(
              (input) =>
                this.normalizeLookupKey(input.name) ===
                this.normalizeLookupKey(color.name),
            )?.available ?? existingColor?.available ?? color.initial;
          if (available > color.initial) {
            throw new BadRequestException(
              'Available color stock cannot exceed its initial stock',
            );
          }
          const data = {
            name: color.name,
            initial: color.initial,
            available,
          };
          nextColors.push(
            existingColor
              ? await tx.productColor.update({
                  where: { id: existingColor.id },
                  data,
                })
              : await tx.productColor.create({
                  data: { id: randomUUID(), productId: id, ...data },
                }),
          );
        }

        const initial =
          colors.length > 0
            ? nextColors.reduce((total, color) => total + color.initial, 0)
            : (updateProductDto.initial ?? currentProduct.initial);
        const available =
          colors.length > 0
            ? nextColors.reduce((total, color) => total + color.available, 0)
            : (updateProductDto.available ?? currentProduct.available);
        await tx.product.updateMany({
          where: { id, deletedAt: null },
          data: {
            ...(updateProductDto.nom === undefined
              ? {}
              : { nom: updateProductDto.nom }),
            ...(updateProductDto.prix === undefined
              ? {}
              : { prix: updateProductDto.prix }),
            ...(updateProductDto.description === undefined
              ? {}
              : { description: updateProductDto.description.trim() }),
            ...(updateProductDto.imageUrl === undefined
              ? {}
              : { imageUrl: updateProductDto.imageUrl }),
            ...(keywords === undefined ? {} : { keywords }),
            initial,
            available,
          },
        });
        return this.findOne(id);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private normalizeLookupKey(value: string) {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr-FR');
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
      const key = this.normalizeLookupKey(trimmed);
      if (!normalized.has(key)) normalized.set(key, trimmed);
    }
    return [...normalized.values()];
  }
}
