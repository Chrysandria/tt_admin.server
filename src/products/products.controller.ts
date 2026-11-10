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
import { ProductsService } from './products.service.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import {
  removeProductImage,
  saveProductImage,
} from './product-images.js';

type MultipartProductFields = {
  nom?: string;
  prix?: string;
  initial?: string | number;
  available?: string | number;
  keywords?: string | string[];
  removeImage?: string | boolean;
};

function parseKeywords(value: string | string[] | undefined) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return value.split(/[,\n;]+/);
}

function parseQuantity(value: string | number | undefined): number | undefined {
  if (typeof value === 'string') return value.trim() ? Number(value) : undefined;
  return value;
}

const productImageInterceptor = FileInterceptor('image', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

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
          ...(fields.keywords === undefined
            ? {}
            : { keywords: parseKeywords(fields.keywords) }),
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
      ...(fields.keywords === undefined
        ? {}
        : { keywords: parseKeywords(fields.keywords) }),
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
    const product = await this.productsService.remove(id);
    await removeProductImage(product.imageUrl);
    return product;
  }
}
