import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateOrderDto,
  CreateOrderItemDto,
} from './dto/create-order.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';

type OrderStatus = 'reserved' | 'payed' | 'canceled';
type OrderItemInput = CreateOrderItemDto;

const ORDER_STATUSES: OrderStatus[] = ['reserved', 'payed', 'canceled'];

export interface FacebookOrderEventInput {
  channel: 'comment' | 'messenger';
  eventId: string;
  senderId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface FacebookOrderEventResult {
  status: string;
  orderId: string | null;
  replyText: string | null;
  replySent: boolean;
  duplicate: boolean;
}

interface FacebookOutcomeInput {
  channel: 'comment' | 'messenger';
  eventId: string;
  senderId: string;
  status: string;
  replyText: string | null;
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createOrderDto: CreateOrderDto) {
    this.validateStatus(createOrderDto.status);
    const items = this.resolveItems(
      createOrderDto.items,
      createOrderDto.product_id,
      createOrderDto.quantity,
    );

    const status = createOrderDto.status ?? 'reserved';
    return this.prisma.$transaction(
      async (tx) => {
        for (const item of items) {
          await this.requireActiveProduct(tx, item.product_id);
          if (status !== 'canceled') {
            await this.decreaseAvailable(
              tx,
              item.product_id,
              item.quantity,
            );
          }
        }

        return tx.order.create({
          data: {
            id: randomUUID(),
            status,
            items: {
              create: items.map((item) => ({
                id: randomUUID(),
                productId: item.product_id,
                quantity: item.quantity,
              })),
            },
          },
          include: { items: { include: { product: true } } },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async createFacebookReservation(
    input: FacebookOrderEventInput,
  ): Promise<FacebookOrderEventResult> {
    if (input.items.length === 0) {
      throw new BadRequestException('At least one product is required');
    }
    const seenProductIds = new Set<string>();
    for (const item of input.items) {
      this.validateQuantity(item.quantity, true);
      if (seenProductIds.has(item.productId)) {
        throw new BadRequestException(
          'A product can only appear once in a Facebook order',
        );
      }
      seenProductIds.add(item.productId);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.facebookWebhookEvent.create({
            data: {
              id: randomUUID(),
              channel: input.channel,
              eventId: input.eventId,
              senderId: input.senderId,
              status: 'processing',
            },
          });

          const reserved: Array<{ productId: string; quantity: number }> = [];
          for (const item of input.items) {
            const reservation = await tx.product.updateMany({
              where: {
                id: item.productId,
                deletedAt: null,
                available: { gte: item.quantity },
              },
              data: { available: { decrement: item.quantity } },
            });

            if (reservation.count === 0) {
              const product = await tx.product.findFirst({
                where: { id: item.productId, deletedAt: null },
                select: { id: true, nom: true },
              });
              for (const priorItem of reserved) {
                await tx.product.updateMany({
                  where: { id: priorItem.productId },
                  data: { available: { increment: priorItem.quantity } },
                });
              }
              const status = product ? 'out_of_stock' : 'unavailable';
              const replyText = product
                ? `Désolé, le stock disponible est insuffisant pour ${product.nom}. Aucune ligne de cette commande n’a été réservée.`
                : 'Désolé, un des produits demandés n’est plus disponible. Aucune ligne de cette commande n’a été réservée.';
            const event = await tx.facebookWebhookEvent.update({
              where: {
                channel_eventId: {
                  channel: input.channel,
                  eventId: input.eventId,
                },
              },
              data: { status, replyText },
            });
              return {
                status: event.status,
                orderId: event.orderId,
                replyText: event.replyText,
                replySent: event.replySent,
                duplicate: false,
              };
            }
            reserved.push(item);
          }

          const order = await tx.order.create({
            data: {
              id: randomUUID(),
              status: 'reserved',
              facebookUserId: input.senderId,
              facebookChannel: input.channel,
              facebookEventId: `${input.channel}:${input.eventId}`,
              items: {
                create: input.items.map((item) => ({
                  id: randomUUID(),
                  productId: item.productId,
                  quantity: item.quantity,
                })),
              },
            },
            include: { items: { include: { product: true } } },
          });
          if (order.items.length !== input.items.length) {
            throw new Error('Facebook reservation did not create an order item');
          }
          const orderLines = order.items.map(
            (item) => `${item.product.nom} x ${item.quantity}`,
          );
          const replyText = `Votre réservation est confirmée : ${orderLines.join(', ')} (commande ${order.id}).`;
          const event = await tx.facebookWebhookEvent.update({
            where: {
              channel_eventId: {
                channel: input.channel,
                eventId: input.eventId,
              },
            },
            data: {
              status: 'reserved',
              orderId: order.id,
              replyText,
            },
          });

          return {
            status: event.status,
            orderId: event.orderId,
            replyText: event.replyText,
            replySent: event.replySent,
            duplicate: false,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return this.findFacebookEvent(input.channel, input.eventId);
    }
  }

  async recordFacebookOutcome(
    input: FacebookOutcomeInput,
  ): Promise<FacebookOrderEventResult> {
    try {
      const event = await this.prisma.facebookWebhookEvent.create({
        data: {
          id: randomUUID(),
          channel: input.channel,
          eventId: input.eventId,
          senderId: input.senderId,
          status: input.status,
          replyText: input.replyText,
        },
      });
      return {
        status: event.status,
        orderId: event.orderId,
        replyText: event.replyText,
        replySent: event.replySent,
        duplicate: false,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return this.findFacebookEvent(input.channel, input.eventId);
    }
  }

  async markFacebookReplySent(channel: 'comment' | 'messenger', eventId: string) {
    return this.prisma.facebookWebhookEvent.update({
      where: { channel_eventId: { channel, eventId } },
      data: { replySent: true },
    });
  }

  findAll() {
    return this.prisma.order.findMany({
      where: { deletedAt: null },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: { items: { include: { product: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  update(id: string, updateOrderDto: UpdateOrderDto) {
    this.validateStatus(updateOrderDto.status);
    if (
      updateOrderDto.product_id !== undefined &&
      (typeof updateOrderDto.product_id !== 'string' ||
        !updateOrderDto.product_id.trim())
    ) {
      throw new BadRequestException('product_id cannot be empty');
    }

    if (updateOrderDto.quantity !== undefined) {
      this.validateQuantity(updateOrderDto.quantity, true);
    }

    return this.prisma.$transaction(
      async (tx) => {
        const currentOrder = await tx.order.findFirst({
          where: { id, deletedAt: null },
          include: { items: true },
        });
        if (!currentOrder) {
          throw new NotFoundException(`Order ${id} not found`);
        }

        const legacyItemsChanged =
          updateOrderDto.product_id !== undefined ||
          updateOrderDto.quantity !== undefined;
        if (legacyItemsChanged && currentOrder.items.length !== 1) {
          throw new BadRequestException(
            'Use items to update a multi-product order',
          );
        }
        const itemsChanged =
          updateOrderDto.items !== undefined || legacyItemsChanged;
        const nextItems = updateOrderDto.items !== undefined
          ? this.resolveItems(updateOrderDto.items)
          : legacyItemsChanged
            ? this.resolveItems(
                undefined,
                updateOrderDto.product_id ?? currentOrder.items[0].productId,
                updateOrderDto.quantity ?? currentOrder.items[0].quantity,
              )
            : currentOrder.items.map((item) => ({
                product_id: item.productId,
                quantity: item.quantity,
              }));
        const nextStatus = updateOrderDto.status ?? currentOrder.status;
        const wasActive = currentOrder.status !== 'canceled';
        const willBeActive = nextStatus !== 'canceled';

        if (itemsChanged || (willBeActive && !wasActive)) {
          for (const item of nextItems) {
            await this.requireActiveProduct(tx, item.product_id);
          }
        }

        const currentQuantities = this.aggregateQuantities(
          currentOrder.items.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
          })),
        );
        const nextQuantities = this.aggregateQuantities(nextItems);
        const affectedProducts = new Set([
          ...currentQuantities.keys(),
          ...nextQuantities.keys(),
        ]);
        for (const productId of affectedProducts) {
          const currentQuantity = wasActive
            ? (currentQuantities.get(productId) ?? 0)
            : 0;
          const nextQuantity = willBeActive
            ? (nextQuantities.get(productId) ?? 0)
            : 0;
          const difference = nextQuantity - currentQuantity;
          if (difference > 0) {
            await this.decreaseAvailable(tx, productId, difference);
          } else if (difference < 0) {
            await this.increaseAvailable(tx, productId, -difference);
          }
        }

        return tx.order.update({
          where: { id },
          data: {
            ...(itemsChanged
              ? {
                  items: {
                    deleteMany: {},
                    create: nextItems.map((item) => ({
                      id: randomUUID(),
                      productId: item.product_id,
                      quantity: item.quantity,
                    })),
                  },
                }
              : {}),
            ...(updateOrderDto.status === undefined
              ? {}
              : { status: updateOrderDto.status }),
          },
          include: { items: { include: { product: true } } },
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
          include: { items: true },
        });
        if (!order) {
          throw new NotFoundException(`Order ${id} not found`);
        }

        if (order.status === 'reserved') {
          for (const item of order.items) {
            await this.increaseAvailable(tx, item.productId, item.quantity);
          }
        }

        return tx.order.update({
          where: { id },
          data: { deletedAt: new Date() },
          include: { items: { include: { product: true } } },
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

  private async requireActiveProduct(
    tx: Prisma.TransactionClient,
    productId: string,
  ) {
    const product = await tx.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
  }

  private resolveItems(
    items?: OrderItemInput[],
    productId?: string,
    quantity?: number,
  ): OrderItemInput[] {
    if (items !== undefined && !Array.isArray(items)) {
      throw new BadRequestException('items must be an array');
    }
    const normalizedItems =
      items ??
      (productId
        ? [{ product_id: productId, quantity: quantity ?? 0 }]
        : []);
    if (normalizedItems.length === 0) {
      throw new BadRequestException('At least one order item is required');
    }

    const seenProductIds = new Set<string>();
    for (const item of normalizedItems) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.product_id !== 'string' ||
        !item.product_id.trim()
      ) {
        throw new BadRequestException('product_id is required');
      }
      this.validateQuantity(item.quantity, true);
      if (seenProductIds.has(item.product_id)) {
        throw new BadRequestException(
          'A product can only appear once in an order',
        );
      }
      seenProductIds.add(item.product_id);
    }
    if (!items && !productId) {
      throw new BadRequestException('At least one order item is required');
    }
    return normalizedItems;
  }

  private aggregateQuantities(items: OrderItemInput[]) {
    return items.reduce((quantities, item) => {
      quantities.set(
        item.product_id,
        (quantities.get(item.product_id) ?? 0) + item.quantity,
      );
      return quantities;
    }, new Map<string, number>());
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

  private async findFacebookEvent(
    channel: 'comment' | 'messenger',
    eventId: string,
  ): Promise<FacebookOrderEventResult> {
    const event = await this.prisma.facebookWebhookEvent.findUnique({
      where: { channel_eventId: { channel, eventId } },
    });
    if (!event) {
      throw new Error(
        'Facebook webhook event could not be loaded after conflict',
      );
    }
    return {
      status: event.status,
      orderId: event.orderId,
      replyText: event.replyText,
      replySent: event.replySent,
      duplicate: true,
    };
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
