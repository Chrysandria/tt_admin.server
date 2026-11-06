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

  it('filters soft-deleted orders from the collection', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});
