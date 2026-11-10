import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from './orders.service.js';

describe('OrdersService', () => {
  let service: OrdersService;
  const transaction = {
    product: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    facebookWebhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
    order: {
      findMany: vi.fn(),
    },
    facebookWebhookEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('decreases available stock when creating a reservation', async () => {
    transaction.product.findFirst.mockResolvedValue({ id: 'product-1' });
    transaction.product.updateMany.mockResolvedValue({ count: 1 });
    transaction.order.create.mockResolvedValue({ id: 'order-1' });

    await service.create({
      product_id: 'product-1',
      quantity: 3,
    });

    expect(transaction.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'product-1',
          available: { gte: 3 },
        }),
        data: { available: { decrement: 3 } },
      }),
    );
    expect(transaction.order.create).toHaveBeenCalled();
  });

  it('creates one order with multiple products and reserves each quantity', async () => {
    transaction.product.findFirst.mockResolvedValue({ id: 'product-1' });
    transaction.product.updateMany.mockResolvedValue({ count: 1 });
    transaction.order.create.mockResolvedValue({ id: 'order-1' });

    await service.create({
      items: [
        { product_id: 'product-1', quantity: 2 },
        { product_id: 'product-2', quantity: 4 },
      ],
    });

    expect(transaction.product.updateMany).toHaveBeenCalledTimes(2);
    expect(transaction.product.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'product-1',
          available: { gte: 2 },
        }),
        data: { available: { decrement: 2 } },
      }),
    );
    expect(transaction.product.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'product-2',
          available: { gte: 4 },
        }),
        data: { available: { decrement: 4 } },
      }),
    );
    expect(transaction.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({
                productId: 'product-1',
                quantity: 2,
              }),
              expect.objectContaining({
                productId: 'product-2',
                quantity: 4,
              }),
            ]),
          },
        }),
      }),
    );
  });

  it('creates an idempotent Facebook order and records its private reply', async () => {
    transaction.facebookWebhookEvent.create.mockResolvedValue({
      status: 'processing',
    });
    transaction.product.updateMany.mockResolvedValue({ count: 1 });
    transaction.order.create.mockResolvedValue({
      id: 'order-facebook',
      items: [
        {
          quantity: 2,
          product: { nom: 'Robe bleue', available: 3 },
        },
        {
          quantity: 1,
          product: { nom: 'Sac rouge', available: 4 },
        },
      ],
    });
    transaction.facebookWebhookEvent.update.mockResolvedValue({
      status: 'reserved',
      orderId: 'order-facebook',
      replyText: 'Votre réservation est confirmée.',
      replySent: false,
    });

    const result = await service.createFacebookReservation({
      channel: 'messenger',
      eventId: 'message-1',
      senderId: 'sender-1',
      items: [
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', quantity: 1 },
      ],
    });

    expect(result).toEqual({
      status: 'reserved',
      orderId: 'order-facebook',
      replyText: 'Votre réservation est confirmée.',
      replySent: false,
      duplicate: false,
    });
    expect(transaction.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'product-1',
          available: { gte: 2 },
        }),
        data: { available: { decrement: 2 } },
      }),
    );
    expect(transaction.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          facebookUserId: 'sender-1',
          facebookChannel: 'messenger',
          facebookEventId: 'messenger:message-1',
          status: 'reserved',
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({ productId: 'product-1', quantity: 2 }),
              expect.objectContaining({ productId: 'product-2', quantity: 1 }),
            ]),
          },
        }),
      }),
    );
  });

  it('records an out-of-stock Facebook event without creating an order', async () => {
    transaction.facebookWebhookEvent.create.mockResolvedValue({
      status: 'processing',
    });
    transaction.product.updateMany.mockResolvedValue({ count: 0 });
    transaction.product.findFirst.mockResolvedValue({ id: 'product-1' });
    transaction.facebookWebhookEvent.update.mockResolvedValue({
      status: 'out_of_stock',
      orderId: null,
      replyText: 'Stock insuffisant',
      replySent: false,
    });

    const result = await service.createFacebookReservation({
      channel: 'comment',
      eventId: 'comment-1',
      senderId: 'sender-1',
      items: [{ productId: 'product-1', quantity: 2 }],
    });

    expect(result.status).toBe('out_of_stock');
    expect(transaction.order.create).not.toHaveBeenCalled();
  });

  it('restores earlier stock deductions when a multi-product request is incomplete', async () => {
    transaction.facebookWebhookEvent.create.mockResolvedValue({
      status: 'processing',
    });
    transaction.product.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    transaction.product.findFirst.mockResolvedValue({
      id: 'product-2',
      nom: 'Sac rouge',
    });
    transaction.facebookWebhookEvent.update.mockResolvedValue({
      status: 'out_of_stock',
      orderId: null,
      replyText: 'Aucune ligne réservée',
      replySent: false,
    });

    await service.createFacebookReservation({
      channel: 'messenger',
      eventId: 'message-no-stock',
      senderId: 'sender-1',
      items: [
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', quantity: 1 },
      ],
    });

    expect(transaction.product.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { id: 'product-1' },
        data: { available: { increment: 2 } },
      }),
    );
    expect(transaction.order.create).not.toHaveBeenCalled();
  });

  it('returns an existing result when Meta redelivers the same event', async () => {
    transaction.facebookWebhookEvent.create.mockRejectedValue({
      code: 'P2002',
    });
    prisma.facebookWebhookEvent.findUnique.mockResolvedValue({
      status: 'reserved',
      orderId: 'order-facebook',
      replyText: 'Déjà réservé',
      replySent: true,
    });

    const result = await service.createFacebookReservation({
      channel: 'messenger',
      eventId: 'message-1',
      senderId: 'sender-1',
      items: [{ productId: 'product-1', quantity: 1 }],
    });

    expect(result).toEqual({
      status: 'reserved',
      orderId: 'order-facebook',
      replyText: 'Déjà réservé',
      replySent: true,
      duplicate: true,
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate products when creating an order', async () => {
    await expect(
      service.create({
        items: [
          { product_id: 'product-1', quantity: 1 },
          { product_id: 'product-1', quantity: 2 },
        ],
      }),
    ).rejects.toThrow('A product can only appear once in an order');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('adjusts stock when products and quantities are changed on an order', async () => {
    transaction.order.findFirst.mockResolvedValue({
      id: 'order-1',
      status: 'reserved',
      items: [{ productId: 'product-1', quantity: 2 }],
    });
    transaction.product.findFirst.mockResolvedValue({ id: 'product-1' });
    transaction.product.updateMany.mockResolvedValue({ count: 1 });
    transaction.order.update.mockResolvedValue({ id: 'order-1' });

    await service.update('order-1', {
      items: [
        { product_id: 'product-1', quantity: 1 },
        { product_id: 'product-2', quantity: 3 },
      ],
    });

    expect(transaction.product.updateMany).toHaveBeenCalledTimes(2);
    expect(transaction.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'product-1' }),
        data: { available: { increment: 1 } },
      }),
    );
    expect(transaction.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'product-2',
          available: { gte: 3 },
        }),
        data: { available: { decrement: 3 } },
      }),
    );
  });

  it('rejects duplicate products when modifying an order', async () => {
    transaction.order.findFirst.mockResolvedValue({
      id: 'order-1',
      status: 'reserved',
      items: [{ productId: 'product-1', quantity: 1 }],
    });

    await expect(
      service.update('order-1', {
        items: [
          { product_id: 'product-1', quantity: 1 },
          { product_id: 'product-1', quantity: 1 },
        ],
      }),
    ).rejects.toThrow('A product can only appear once in an order');
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('filters soft-deleted orders from the collection', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});
