import { Test, TestingModule } from '@nestjs/testing';
import { FacebookGraphService } from '../facebook/facebook-graph.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

describe('ProductsController', () => {
  let controller: ProductsController;
  let productsService: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let facebookGraphService: { deletePagePost: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    productsService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    facebookGraphService = { deletePagePost: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: productsService,
        },
        {
          provide: FacebookGraphService,
          useValue: facebookGraphService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('deletes the Facebook post before removing a linked product', async () => {
    productsService.findOne.mockResolvedValue({
      facebookPostId: 'post-1',
    });
    productsService.remove.mockResolvedValue({ imageUrl: null });

    await controller.remove('product-1');

    expect(facebookGraphService.deletePagePost).toHaveBeenCalledWith('post-1');
    expect(
      facebookGraphService.deletePagePost.mock.invocationCallOrder[0],
    ).toBeLessThan(productsService.remove.mock.invocationCallOrder[0]);
  });

  it('does not remove the product when Facebook post deletion fails', async () => {
    productsService.findOne.mockResolvedValue({
      facebookPostId: 'post-1',
    });
    facebookGraphService.deletePagePost.mockRejectedValue(
      new Error('Facebook deletion failed'),
    );

    await expect(controller.remove('product-1')).rejects.toThrow(
      'Facebook deletion failed',
    );
    expect(productsService.remove).not.toHaveBeenCalled();
  });

  it('removes products without a Facebook post without calling Meta', async () => {
    productsService.findOne.mockResolvedValue({ facebookPostId: null });
    productsService.remove.mockResolvedValue({ imageUrl: null });

    await controller.remove('product-1');

    expect(facebookGraphService.deletePagePost).not.toHaveBeenCalled();
    expect(productsService.remove).toHaveBeenCalledWith('product-1');
  });
});
