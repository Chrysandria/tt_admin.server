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
