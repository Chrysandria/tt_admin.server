import { Module } from '@nestjs/common';
import { FacebookModule } from '../facebook/facebook.module.js';
import { ProductsService } from './products.service.js';
import { ProductsController } from './products.controller.js';

@Module({
  imports: [FacebookModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
