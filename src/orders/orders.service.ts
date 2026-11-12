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
  items: Array<{
    productId: string;
    productColorId?: string;
    quantity: number;
  }>;
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
    this.validateCustomerDetails(createOrderDto);
    this.validateDelivered(createOrderDto.delivered);
    const items = this.resolveItems(
      createOrderDto.items,
      createOrderDto.product_id,
      createOrderDto.quantity,
      createOrderDto.product_color_id,
    );

    const status = createOrderDto.status ?? 'reserved';
    if (createOrderDto.delivered && status === 'canceled') {
      throw new BadRequestException('A canceled order cannot be marked delivered');
    }
    return this.prisma.$transaction(
      async (tx) => {
        for (const item of items) {
          await this.requireActiveProduct(
            tx,
            item.product_id,
            item.product_color_id,
          );
          if (status !== 'canceled') {
            await this.reserveStock(
              tx,
              item.product_id,
              item.quantity,
              item.product_color_id,
            );
          }
        }

        return tx.order.create({
          data: {
            id: randomUUID(),
            status,
            ...(createOrderDto.customer_name !== undefined
              ? { customerName: this.normalizeCustomerValue(createOrderDto.customer_name) }
              : {}),
            ...(createOrderDto.delivery_address !== undefined
              ? { deliveryAddress: this.normalizeCustomerValue(createOrderDto.delivery_address) }
              : {}),
            ...(createOrderDto.customer_phone !== undefined
              ? { customerPhone: this.normalizeCustomerValue(createOrderDto.customer_phone) }
              : {}),
            ...(createOrderDto.delivered ? { deliveredAt: new Date() } : {}),
            items: {
              create: items.map((item) => ({
                id: randomUUID(),
                productId: item.product_id,
                ...(item.product_color_id
                  ? { productColorId: item.product_color_id }
                  : {}),
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
    if (input.items.length !== 1) {
      throw new BadRequestException(
        'A Facebook order must contain exactly one product',
      );
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

          const item = input.items[0];
          if (!item) {
            throw new BadRequestException('A Facebook order needs one product');
          }
          await this.requireActiveProduct(
            tx,
            item.productId,
            item.productColorId,
          );
          const reservation = await this.reserveStock(
            tx,
            item.productId,
            item.quantity,
            item.productColorId,
            true,
          );

          if (!reservation.reserved) {
            const replyText = reservation.colorName
              ? `Désolé, la couleur ${reservation.colorName} est épuisée. Aucune commande n’a été créée.`
              : 'Désolé, le stock disponible est insuffisant. Aucune commande n’a été créée.';
            const event = await tx.facebookWebhookEvent.update({
              where: {
                channel_eventId: {
                  channel: input.channel,
                  eventId: input.eventId,
                },
              },
              data: { status: 'out_of_stock', replyText },
            });
            return {
              status: event.status,
              orderId: event.orderId,
              replyText: event.replyText,
              replySent: event.replySent,
              duplicate: false,
            };
          }

          const order = await tx.order.create({
            data: {
              id: randomUUID(),
              status: 'reserved',
              facebookUserId: input.senderId,
              facebookChannel: input.channel,
              facebookEventId: `${input.channel}:${input.eventId}`,
              items: {
                create: [
                  {
                    id: randomUUID(),
                    productId: item.productId,
                    ...(item.productColorId
                      ? { productColorId: item.productColorId }
                      : {}),
                    quantity: item.quantity,
                  },
                ],
              },
            },
            include: {
              items: { include: { product: true, productColor: true } },
            },
          });
          if (order.items.length !== 1) {
            throw new Error('Facebook reservation did not create one order item');
          }
          const orderLine = order.items[0];
          const replyText = orderLine
            ? `Votre réservation est confirmée : ${orderLine.product.nom}${orderLine.productColor ? ` (${orderLine.productColor.name})` : ''} x ${orderLine.quantity} (commande ${order.id}).`
            : `Votre réservation est confirmée (commande ${order.id}).`;
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

  async savePendingFacebookOrder(
    senderId: string,
    productId: string,
    quantity: number,
  ) {
    this.validateQuantity(quantity, true);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    return this.prisma.facebookPendingOrder.upsert({
      where: { senderId },
      create: {
        id: randomUUID(),
        senderId,
        productId,
        quantity,
        expiresAt,
      },
      update: { productId, quantity, expiresAt },
    });
  }

  async getPendingFacebookOrder(senderId: string) {
    const pending = await this.prisma.facebookPendingOrder.findUnique({
      where: { senderId },
      include: { product: { include: { colors: true } } },
    });
    if (!pending) return null;
    if (pending.expiresAt <= new Date()) {
      await this.clearPendingFacebookOrder(senderId);
      return null;
    }
    return pending;
  }

  clearPendingFacebookOrder(senderId: string) {
    return this.prisma.facebookPendingOrder.deleteMany({
      where: { senderId },
    });
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
      include: { items: { include: { product: true, productColor: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: { items: { include: { product: true, productColor: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  update(id: string, updateOrderDto: UpdateOrderDto) {
    this.validateStatus(updateOrderDto.status);
    this.validateCustomerDetails(updateOrderDto);
    this.validateDelivered(updateOrderDto.delivered);
    if (
      updateOrderDto.product_id !== undefined &&
      (typeof updateOrderDto.product_id !== 'string' ||
        !updateOrderDto.product_id.trim())
    ) {
      throw new BadRequestException('product_id cannot be empty');
    }
    if (
      updateOrderDto.product_color_id !== undefined &&
      !updateOrderDto.product_color_id.trim()
    ) {
      throw new BadRequestException('product_color_id cannot be empty');
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
          updateOrderDto.product_color_id !== undefined ||
          updateOrderDto.quantity !== undefined;
        const itemsChanged =
          updateOrderDto.items !== undefined || legacyItemsChanged;
        const nextItems = updateOrderDto.items !== undefined
          ? this.resolveItems(updateOrderDto.items)
          : legacyItemsChanged
            ? this.resolveItems(
                undefined,
                updateOrderDto.product_id ?? currentOrder.items[0].productId,
                updateOrderDto.quantity ?? currentOrder.items[0].quantity,
                updateOrderDto.product_color_id,
              )
            : currentOrder.items.map((item) => ({
                product_id: item.productId,
                ...(item.productColorId
                  ? { product_color_id: item.productColorId }
                  : {}),
                quantity: item.quantity,
              }));
        const nextStatus = updateOrderDto.status ?? currentOrder.status;
        if (
          updateOrderDto.delivered === true &&
          nextStatus === 'canceled'
        ) {
          throw new BadRequestException(
            'A canceled order cannot be marked delivered',
          );
        }
        const wasActive = currentOrder.status !== 'canceled';
        const willBeActive = nextStatus !== 'canceled';

        if (itemsChanged || (willBeActive && !wasActive)) {
          for (const item of nextItems) {
            await this.requireActiveProduct(
              tx,
              item.product_id,
              item.product_color_id,
            );
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
        const currentColorQuantities = this.aggregateColorQuantities(
          currentOrder.items.map((item) => ({
            product_color_id: item.productColorId,
            quantity: item.quantity,
          })),
        );
        const nextColorQuantities = this.aggregateColorQuantities(nextItems);
        const affectedColors = new Set([
          ...currentColorQuantities.keys(),
          ...nextColorQuantities.keys(),
        ]);
        for (const colorId of affectedColors) {
          const currentQuantity = wasActive
            ? (currentColorQuantities.get(colorId) ?? 0)
            : 0;
          const nextQuantity = willBeActive
            ? (nextColorQuantities.get(colorId) ?? 0)
            : 0;
          const difference = nextQuantity - currentQuantity;
          if (difference > 0) {
            await this.decreaseColorAvailable(tx, colorId, difference);
          } else if (difference < 0) {
            await this.increaseColorAvailable(tx, colorId, -difference);
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
                      ...(item.product_color_id
                        ? { productColorId: item.product_color_id }
                        : {}),
                      quantity: item.quantity,
                    })),
                  },
                }
              : {}),
            ...(updateOrderDto.status === undefined
              ? {}
              : { status: updateOrderDto.status }),
            ...(updateOrderDto.customer_name === undefined
              ? {}
              : {
                  customerName: this.normalizeCustomerValue(
                    updateOrderDto.customer_name,
                  ),
                }),
            ...(updateOrderDto.delivery_address === undefined
              ? {}
              : {
                  deliveryAddress: this.normalizeCustomerValue(
                    updateOrderDto.delivery_address,
                  ),
                }),
            ...(updateOrderDto.customer_phone === undefined
              ? {}
              : {
                  customerPhone: this.normalizeCustomerValue(
                    updateOrderDto.customer_phone,
                  ),
                }),
            ...(updateOrderDto.delivered === undefined
              ? {}
              : {
                  deliveredAt: updateOrderDto.delivered
                    ? (currentOrder.deliveredAt ?? new Date())
                    : null,
                }),
          },
          include: {
            items: { include: { product: true, productColor: true } },
          },
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
            if (item.productColorId) {
              await this.increaseColorAvailable(
                tx,
                item.productColorId,
                item.quantity,
              );
            }
          }
        }

        return tx.order.update({
          where: { id },
          data: { deletedAt: new Date() },
          include: {
            items: { include: { product: true, productColor: true } },
          },
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
    productColorId?: string,
  ) {
    const product = await tx.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        colors: productColorId
          ? { where: { id: productColorId }, select: { id: true } }
          : { select: { id: true } },
      },
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    if (productColorId && product.colors.length === 0) {
      throw new NotFoundException(`Product color ${productColorId} not found`);
    }
  }

  private resolveItems(
    items?: OrderItemInput[],
    productId?: string,
    quantity?: number,
    productColorId?: string,
  ): OrderItemInput[] {
    if (items !== undefined && !Array.isArray(items)) {
      throw new BadRequestException('items must be an array');
    }
    const normalizedItems =
      items ??
      (productId
        ? [
            {
              product_id: productId,
              ...(productColorId
                ? { product_color_id: productColorId }
                : {}),
              quantity: quantity ?? 0,
            },
          ]
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
      if (
        item.product_color_id !== undefined &&
        (typeof item.product_color_id !== 'string' ||
          !item.product_color_id.trim())
      ) {
        throw new BadRequestException('product_color_id cannot be empty');
      }
      this.validateQuantity(item.quantity, true);
      if (seenProductIds.has(item.product_id)) {
        throw new BadRequestException(
          'A product can only appear once in an order',
        );
      }
      seenProductIds.add(item.product_id);
    }
    if (normalizedItems.length > 1) {
      throw new BadRequestException(
        'An order can contain only one product',
      );
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

  private aggregateColorQuantities(
    items: Array<{ product_color_id?: string | null; quantity: number }>,
  ) {
    return items.reduce((quantities, item) => {
      if (!item.product_color_id) return quantities;
      quantities.set(
        item.product_color_id,
        (quantities.get(item.product_color_id) ?? 0) + item.quantity,
      );
      return quantities;
    }, new Map<string, number>());
  }

  private async reserveStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
    productColorId?: string,
    facebookMode = false,
  ) {
    if (productColorId) {
      const color = await tx.productColor.findFirst({
        where: { id: productColorId, productId },
        select: { id: true, name: true, available: true },
      });
      if (!color) {
        throw new NotFoundException(
          `Product color ${productColorId} not found for product ${productId}`,
        );
      }
      if (color.available < quantity) {
        if (!facebookMode) {
          throw new BadRequestException(
            `Insufficient available stock for color ${color.name}`,
          );
        }
        return {
          reserved: false,
          colorName: color.name,
        };
      }
      const colorResult = await tx.productColor.updateMany({
        where: { id: productColorId, productId, available: { gte: quantity } },
        data: { available: { decrement: quantity } },
      });
      if (colorResult.count === 0) {
        if (facebookMode) {
          return { reserved: false, colorName: color.name };
        }
        throw new BadRequestException(
          `Insufficient available stock for color ${color.name}`,
        );
      }
      const productResult = await tx.product.updateMany({
        where: { id: productId, deletedAt: null, available: { gte: quantity } },
        data: { available: { decrement: quantity } },
      });
      if (productResult.count === 0) {
        throw new BadRequestException('Insufficient available stock');
      }
      return { reserved: true, colorName: color.name };
    }

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
      if (facebookMode) {
        return { reserved: false };
      }
      throw new BadRequestException('Insufficient available stock');
    }
    return { reserved: true };
  }

  private async decreaseColorAvailable(
    tx: Prisma.TransactionClient,
    colorId: string,
    quantity: number,
  ) {
    const result = await tx.productColor.updateMany({
      where: { id: colorId, available: { gte: quantity } },
      data: { available: { decrement: quantity } },
    });
    if (result.count === 0) {
      throw new BadRequestException('Insufficient available color stock');
    }
  }

  private async increaseColorAvailable(
    tx: Prisma.TransactionClient,
    colorId: string,
    quantity: number,
  ) {
    const result = await tx.productColor.updateMany({
      where: { id: colorId },
      data: { available: { increment: quantity } },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Product color ${colorId} not found`);
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

  private validateCustomerDetails(input: {
    customer_name?: string | null;
    delivery_address?: string | null;
    customer_phone?: string | null;
  }) {
    const fields = [
      ['customer_name', input.customer_name, 120],
      ['delivery_address', input.delivery_address, 500],
      ['customer_phone', input.customer_phone, 40],
    ] as const;
    for (const [field, value, maxLength] of fields) {
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'string' || value.trim().length > maxLength)
      ) {
        throw new BadRequestException(
          `${field} must be text with at most ${maxLength} characters`,
        );
      }
    }
  }

  private validateDelivered(delivered: boolean | undefined) {
    if (delivered !== undefined && typeof delivered !== 'boolean') {
      throw new BadRequestException('delivered must be a boolean');
    }
  }

  private normalizeCustomerValue(value: string | null) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
