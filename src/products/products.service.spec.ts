import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProductsService } from './products.service.js';

describe('ProductsService', () => {
  let service: ProductsService;
  const prisma = {
    product: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('creates a product with its initial quantity available', async () => {
    prisma.product.create.mockResolvedValue({ id: 'product-1' });

    await service.create({ nom: 'Coffee', prix: '12.50', initial: 8 });

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ initial: 8, available: 8 }),
      }),
    );
  });

  it('stores trimmed, case- and accent-insensitive unique keywords', async () => {
    prisma.product.create.mockResolvedValue({ id: 'product-1' });

    await service.create({
      nom: 'Sac naturel',
      prix: '12.50',
      initial: 8,
      keywords: [' sac raphia ', 'SÁC RAPHIA', 'fait main'],
    });

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keywords: ['sac raphia', 'fait main'],
        }),
      }),
    );
  });

  it('rejects invalid keyword lists', async () => {
    await expect(
      service.create({
        nom: 'Sac naturel',
        prix: '12.50',
        initial: 8,
        keywords: Array.from({ length: 31 }, (_, index) => `mot ${index}`),
      }),
    ).rejects.toThrow('at most 30 entries');
  });

  it('excludes soft-deleted products from the collection', async () => {
    prisma.product.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('soft-deletes a product instead of deleting it', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'product-1',
      deletedAt: new Date(),
    });

    await service.remove('product-1');

    expect(prisma.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1', deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });
});
