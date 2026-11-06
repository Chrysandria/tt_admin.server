import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';

type OrderStatus = 'reserved' | 'payed' | 'canceled';

const ORDER_STATUSES: OrderStatus[] = ['reserved', 'payed', 'canceled'];

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  create(createOrderDto: CreateOrderDto) {
    this.validateQuantity(createOrderDto.quantity, true);
    this.validateStatus(createOrderDto.status);
    if (
      typeof createOrderDto.product_id !== 'string' ||
      !createOrderDto.product_id.trim()
    ) {
      throw new BadRequestException('product_id is required');
    }

    const status = createOrderDto.status ?? 'reserved';
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: createOrderDto.product_id, deletedAt: null },
          select: { id: true },
        });
        if (!product) {
          throw new NotFoundException(
            `Product ${createOrderDto.product_id} not found`,
          );
        }
        if (status !== 'canceled') {
          await this.decreaseAvailable(
            tx,
            createOrderDto.product_id,
            createOrderDto.quantity,
          );
        }

        return tx.order.create({
          data: {
            id: randomUUID(),
            productId: createOrderDto.product_id,
            quantity: createOrderDto.quantity,
            status,
          },
          include: { product: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  findAll() {
    return this.prisma.order.findMany({
      where: { deletedAt: null },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: { product: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  update(id: string, updateOrderDto: UpdateOrderDto) {
    this.validateQuantity(updateOrderDto.quantity);
    this.validateStatus(updateOrderDto.status);
    if (
      updateOrderDto.product_id !== undefined &&
      (typeof updateOrderDto.product_id !== 'string' ||
        !updateOrderDto.product_id.trim())
    ) {
      throw new BadRequestException('product_id cannot be empty');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const currentOrder = await tx.order.findFirst({
          where: { id, deletedAt: null },
        });
        if (!currentOrder) {
          throw new NotFoundException(`Order ${id} not found`);
        }

        const nextProductId =
          updateOrderDto.product_id ?? currentOrder.productId;
        const nextQuantity = updateOrderDto.quantity ?? currentOrder.quantity;
        const nextStatus = updateOrderDto.status ?? currentOrder.status;
        const productChanged = nextProductId !== currentOrder.productId;
        const wasActive = currentOrder.status !== 'canceled';
        const willBeActive = nextStatus !== 'canceled';

        if (productChanged || (willBeActive && !wasActive)) {
          const nextProduct = await tx.product.findFirst({
            where: { id: nextProductId, deletedAt: null },
            select: { id: true },
          });
          if (!nextProduct) {
            throw new NotFoundException(`Product ${nextProductId} not found`);
          }
        }

        if (
          wasActive &&
          willBeActive &&
          !productChanged &&
          currentOrder.status !== 'canceled'
        ) {
          const difference = nextQuantity - currentOrder.quantity;
          if (difference > 0) {
            await this.decreaseAvailable(tx, nextProductId, difference);
          } else if (difference < 0) {
            await this.increaseAvailable(tx, nextProductId, -difference);
          }
        } else {
          if (wasActive) {
            await this.increaseAvailable(
              tx,
              currentOrder.productId,
              currentOrder.quantity,
            );
          }
          if (willBeActive) {
            await this.decreaseAvailable(tx, nextProductId, nextQuantity);
          }
        }

        return tx.order.update({
          where: { id },
          data: {
            ...(updateOrderDto.product_id === undefined
              ? {}
              : { productId: updateOrderDto.product_id }),
            ...(updateOrderDto.quantity === undefined
              ? {}
              : { quantity: updateOrderDto.quantity }),
            ...(updateOrderDto.status === undefined
              ? {}
              : { status: updateOrderDto.status }),
          },
          include: { product: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  remove(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findFirst({
          where: { id, deletedAt: null },
        });
        if (!order) {
          throw new NotFoundException(`Order ${id} not found`);
        }

        if (order.status === 'reserved') {
          await this.increaseAvailable(tx, order.productId, order.quantity);
        }

        return tx.order.update({
          where: { id },
          data: { deletedAt: new Date() },
          include: { product: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async decreaseAvailable(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ) {
    const result = await tx.product.updateMany({
      where: {
        id: productId,
        deletedAt: null,
        available: { gte: quantity },
      },
      data: { available: { decrement: quantity } },
    });
    if (result.count === 0) {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException(`Product ${productId} not found`);
      }
      throw new BadRequestException('Insufficient available stock');
    }
  }

  private async increaseAvailable(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ) {
    const result = await tx.product.updateMany({
      where: { id: productId },
      data: { available: { increment: quantity } },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
  }

  private validateQuantity(quantity: number | undefined, required = false) {
    if (
      (required && quantity === undefined) ||
      (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0))
    ) {
      throw new BadRequestException('quantity must be a positive integer');
    }
  }

  private validateStatus(status: string | undefined) {
    if (
      status !== undefined &&
      !ORDER_STATUSES.some((validStatus) => validStatus === status)
    ) {
      throw new BadRequestException('Invalid order status');
    }
  }
}
