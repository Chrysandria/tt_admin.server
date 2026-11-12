import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FacebookGraphService } from './facebook-graph.service.js';
import { FacebookService } from './facebook.service.js';

describe('FacebookService', () => {
  let service: FacebookService;
  const prisma = {
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    facebookPageSettings: {
      upsert: vi.fn(),
    },
  };
  const ordersService = {
    createFacebookReservation: vi.fn(),
    recordFacebookOutcome: vi.fn(),
    markFacebookReplySent: vi.fn(),
  };
  const graph = {
    ensureConfigured: vi.fn(),
    getMessengerLink: vi.fn(),
    publishPagePost: vi.fn(),
    sendCommentPrivateReply: vi.fn(),
    sendMessengerReply: vi.fn(),
  };
  const originalPageId = process.env.FACEBOOK_PAGE_ID;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.FACEBOOK_PAGE_ID = 'page-1';
    graph.getMessengerLink.mockReturnValue('https://m.me/page-1');
    graph.publishPagePost.mockResolvedValue('published-1');
    prisma.product.findMany.mockResolvedValue([
      { id: 'product-1', nom: 'Robe bleue', keywords: ['robe azur'] },
      { id: 'product-2', nom: 'Sac rouge', keywords: ['sac'] },
    ]);
    prisma.facebookPageSettings.upsert.mockResolvedValue({
      greetingMessage: 'Bonjour, nous revenons vers vous rapidement.',
      updatedAt: new Date(),
    });
    ordersService.createFacebookReservation.mockResolvedValue({
      status: 'reserved',
      orderId: 'order-1',
      replyText: 'Réservation confirmée',
      replySent: false,
      duplicate: false,
    });
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'ambiguous',
      orderId: null,
      replyText: 'Nom ambigu',
      replySent: false,
      duplicate: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: FacebookGraphService, useValue: graph },
      ],
    }).compile();

    service = module.get(FacebookService);
  });

  afterAll(() => {
    if (originalPageId === undefined) {
      delete process.env.FACEBOOK_PAGE_ID;
    } else {
      process.env.FACEBOOK_PAGE_ID = originalPageId;
    }
  });

  it('reserves an exact product from a post or Live comment and replies privately', async () => {
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-1',
                from: { id: 'customer-1' },
                message: 'Robe bleue 2',
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).toHaveBeenCalledWith({
      channel: 'comment',
      eventId: 'comment-1',
      senderId: 'customer-1',
      items: [{ productId: 'product-1', quantity: 2 }],
    });
    expect(graph.sendCommentPrivateReply).toHaveBeenCalledWith(
      'comment-1',
      'Réservation confirmée',
    );
    expect(graph.sendMessengerReply).not.toHaveBeenCalled();
    expect(ordersService.markFacebookReplySent).toHaveBeenCalledWith(
      'comment',
      'comment-1',
    );
  });

  it('sends the configured welcome message for unrecognized Messenger messages', async () => {
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'greeting',
      orderId: null,
      replyText: 'Bonjour, nous revenons vers vous rapidement.',
      replySent: false,
      duplicate: false,
    });
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: { mid: 'message-welcome', text: 'Bonjour !' },
            },
          ],
        },
      ],
    });

    expect(ordersService.recordFacebookOutcome).toHaveBeenCalledWith({
      channel: 'messenger',
      eventId: 'message-welcome',
      senderId: 'customer-1',
      status: 'greeting',
      replyText: 'Bonjour, nous revenons vers vous rapidement.',
    });
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      'Bonjour, nous revenons vers vous rapidement.',
    );
    expect(ordersService.markFacebookReplySent).toHaveBeenCalledWith(
      'messenger',
      'message-welcome',
    );
  });

  it('sends the configured welcome message privately for unrelated comments', async () => {
    ordersService.recordFacebookOutcome.mockResolvedValue({
      status: 'greeting',
      orderId: null,
      replyText: 'Bonjour, nous revenons vers vous rapidement.',
      replySent: false,
      duplicate: false,
    });
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-welcome',
                from: { id: 'customer-1' },
                message: 'Avez-vous une boutique ?',
              },
            },
          ],
        },
      ],
    });

    expect(graph.sendCommentPrivateReply).toHaveBeenCalledWith(
      'comment-welcome',
      'Bonjour, nous revenons vers vous rapidement.',
    );
  });

  it('adds the Messenger link to a post when requested', async () => {
    await service.publishPagePost('Nouvelle collection', undefined, true);

    expect(graph.publishPagePost).toHaveBeenCalledWith(
      'Nouvelle collection\n\nÉcrivez-nous sur Messenger : https://m.me/page-1',
      undefined,
    );
  });

  it('publishes an unpublished product with its details and records the post ID', async () => {
    prisma.product.findFirst
      .mockResolvedValueOnce({
        id: 'product-1',
        nom: 'Robe bleue',
        description: 'Robe légère en coton',
        prix: '25 000 Ar',
        imageUrl: null,
        facebookPostId: null,
      })
      .mockResolvedValueOnce({
        id: 'product-1',
        facebookPostId: null,
      });
    prisma.product.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.publishProduct('product-1')).resolves.toBe(
      'published-1',
    );

    expect(graph.publishPagePost).toHaveBeenCalledWith(
      'Nouveau produit : Robe bleue\n\nRobe légère en coton\n\nPrix : 25 000 Ar\n\nÉcrivez-nous sur Messenger : https://m.me/page-1',
      undefined,
    );
    expect(prisma.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'product-1',
          deletedAt: null,
          facebookPostId: null,
        },
        data: expect.objectContaining({ facebookPostId: 'published-1' }),
      }),
    );
  });

  it('does not publish a product that already has a Facebook post', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1',
      facebookPostId: 'existing-post',
    });

    await expect(service.publishProduct('product-1')).rejects.toThrow(
      'The product has already been published',
    );
    expect(graph.publishPagePost).not.toHaveBeenCalled();
  });

  it('does not duplicate a Messenger link already in the post', async () => {
    await service.publishPagePost(
      'Contactez-nous : https://m.me/page-1',
      undefined,
      true,
    );

    expect(graph.publishPagePost).toHaveBeenCalledWith(
      'Contactez-nous : https://m.me/page-1',
      undefined,
    );
  });

  it('rejects a post if adding the Messenger link exceeds the text limit', async () => {
    await expect(
      service.publishPagePost('a'.repeat(5000), undefined, true),
    ).rejects.toThrow('Publication text cannot exceed 5000 characters');
    expect(graph.publishPagePost).not.toHaveBeenCalled();
  });

  it('reserves a Messenger request and skips echoes and other pages', async () => {
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'another-page',
          messaging: [
            {
              sender: { id: 'customer-ignored' },
              message: { mid: 'echo-1', text: 'Robe bleue' },
            },
          ],
        },
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: {
                mid: 'message-1',
                text: '2 robe azur',
                is_echo: false,
              },
            },
            {
              sender: { id: 'page-1' },
              message: {
                mid: 'echo-2',
                text: 'Robe bleue',
                is_echo: true,
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).toHaveBeenCalledTimes(1);
    expect(ordersService.createFacebookReservation).toHaveBeenCalledWith({
      channel: 'messenger',
      eventId: 'message-1',
      senderId: 'customer-1',
      items: [{ productId: 'product-1', quantity: 2 }],
    });
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      'Réservation confirmée',
    );
  });

  it('asks customers to split requests for different products', async () => {
    await service.handleWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'customer-1' },
              recipient: { id: 'page-1' },
              message: {
                mid: 'message-multiple-products',
                text: '2 robe azur et sac',
                is_echo: false,
              },
            },
          ],
        },
      ],
    });

    expect(ordersService.createFacebookReservation).not.toHaveBeenCalled();
    expect(ordersService.recordFacebookOutcome).toHaveBeenCalledWith({
      channel: 'messenger',
      eventId: 'message-multiple-products',
      senderId: 'customer-1',
      status: 'ambiguous',
      replyText:
        'Merci d’indiquer un seul produit et sa quantité par message. Pour plusieurs produits, envoyez un message distinct pour chacun.',
    });
    expect(graph.sendMessengerReply).toHaveBeenCalledWith(
      'customer-1',
      'Nom ambigu',
    );
  });
});
