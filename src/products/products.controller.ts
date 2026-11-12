import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FacebookGraphService } from '../facebook/facebook-graph.service.js';
import { ProductsService } from './products.service.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { CreateProductColorDto } from './dto/create-product.dto.js';
import {
  removeProductImage,
  saveProductImage,
} from './product-images.js';

type MultipartProductFields = {
  nom?: string;
  description?: string;
  prix?: string;
  initial?: string | number;
  available?: string | number;
  keywords?: string | string[];
  colors?: string | CreateProductColorDto[];
  removeImage?: string | boolean;
}

function parseKeywords(value: string | string[] | undefined) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return value.split(/[,\n;]+/);
}

function parseQuantity(value: string | number | undefined): number | undefined {
  if (typeof value === 'string') return value.trim() ? Number(value) : undefined;
  return value;
}

function parseColors(
  value: string | CreateProductColorDto[] | undefined,
): CreateProductColorDto[] | undefined {
  if (value === undefined) return undefined;
  let colors: unknown = value;
  if (typeof value === 'string') {
    try {
      colors = JSON.parse(value) as unknown;
    } catch {
      throw new BadRequestException('colors must be a valid JSON list');
    }
  }
  if (!Array.isArray(colors)) {
    throw new BadRequestException('colors must be a list');
  }
  return colors.map((color) => {
    if (typeof color !== 'object' || color === null || Array.isArray(color)) {
      throw new BadRequestException('Each color must be an object');
    }
    if (!('name' in color) || !('initial' in color)) {
      throw new BadRequestException('Each color needs a name and initial stock');
    }
    const name = color.name;
    const initialValue = color.initial;
    const availableValue = 'available' in color ? color.available : undefined;
    if (typeof name !== 'string') {
      throw new BadRequestException('Each color name must be text');
    }
    if (
      typeof initialValue !== 'number' &&
      typeof initialValue !== 'string'
    ) {
      throw new BadRequestException('Each color needs valid initial stock');
    }
    const initial = parseQuantity(initialValue);
    if (initial === undefined) {
      throw new BadRequestException('Each color needs initial stock');
    }
    let available: number | undefined;
    if (availableValue !== undefined) {
      if (
        typeof availableValue !== 'number' &&
        typeof availableValue !== 'string'
      ) {
        throw new BadRequestException('Each color needs valid available stock');
      }
      available = parseQuantity(availableValue);
    }
    return {
      name,
      initial,
      ...(available === undefined ? {} : { available }),
    };
  });
}

const productImageInterceptor = FileInterceptor('image', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly facebookGraphService: FacebookGraphService,
  ) {}

  @Post()
  @UseInterceptors(productImageInterceptor)
  async create(
    @Body() fields: MultipartProductFields,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    const initial = parseQuantity(fields.initial);
    if (initial === undefined) {
      throw new BadRequestException('initial is required');
    }
    const imageUrl = await saveProductImage(image);
    try {
      return await this.productsService.create(
        {
          nom: fields.nom ?? '',
          description: fields.description ?? '',
          ...(fields.keywords === undefined
            ? {}
            : { keywords: parseKeywords(fields.keywords) }),
          ...(fields.colors === undefined
            ? {}
            : { colors: parseColors(fields.colors) }),
          prix: fields.prix ?? '',
          initial,
        },
        imageUrl,
      );
    } catch (error) {
      await removeProductImage(imageUrl);
      throw error;
    }
  }

  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  @UseInterceptors(productImageInterceptor)
  async update(
    @Param('id') id: string,
    @Body() fields: MultipartProductFields,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    const removeImage = fields.removeImage === true || fields.removeImage === 'true';
    if (removeImage && image) {
      throw new BadRequestException('Choose an image or remove the current image');
    }
    const currentProduct = await this.productsService.findOne(id);
    const nextImageUrl = image ? await saveProductImage(image) : null;
    const updateData: UpdateProductDto = {
      ...(fields.nom === undefined ? {} : { nom: fields.nom }),
      ...(fields.description === undefined
        ? {}
        : { description: fields.description }),
      ...(fields.keywords === undefined
        ? {}
        : { keywords: parseKeywords(fields.keywords) }),
      ...(fields.colors === undefined
        ? {}
        : { colors: parseColors(fields.colors) }),
      ...(fields.prix === undefined ? {} : { prix: fields.prix }),
      ...(fields.initial === undefined
        ? {}
        : { initial: parseQuantity(fields.initial) }),
      ...(fields.available === undefined
        ? {}
        : { available: parseQuantity(fields.available) }),
      ...(nextImageUrl
        ? { imageUrl: nextImageUrl }
        : removeImage
          ? { imageUrl: null }
          : {}),
    };

    let updatedProduct;
    try {
      updatedProduct = await this.productsService.update(id, updateData);
    } catch (error) {
      await removeProductImage(nextImageUrl);
      throw error;
    }
    if (nextImageUrl || removeImage) {
      await removeProductImage(currentProduct.imageUrl);
    }
    return updatedProduct;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existingProduct = await this.productsService.findOne(id);
    if (existingProduct.facebookPostId) {
      await this.facebookGraphService.deletePagePost(
        existingProduct.facebookPostId,
      );
    }

    const product = await this.productsService.remove(id);
    await removeProductImage(product.imageUrl);
    return product;
  }
}
