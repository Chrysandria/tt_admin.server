import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  FacebookCatalogProduct,
  matchFacebookProductMessage,
} from './facebook-message.js';
import {
  FacebookGraphService,
  type FacebookImage,
} from './facebook-graph.service.js';
import { readProductImageForFacebook } from '../products/product-images.js';

type FacebookChannel = 'comment' | 'messenger';

interface IncomingFacebookEvent {
  channel: FacebookChannel;
  eventId: string;
  senderId: string;
  text: string;
  commentId?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNestedId(record: JsonRecord, key: string) {
  const value = record[key];
  return isRecord(value) ? getString(value, 'id') : undefined;
}

function getEntries(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

@Injectable()
export class FacebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly graph: FacebookGraphService,
  ) {}

  async getPageSettings() {
    const settings = await this.prisma.facebookPageSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    return {
      greetingMessage: settings.greetingMessage,
      updatedAt: settings.updatedAt,
    };
  }

  async updateGreetingMessage(greetingMessage: unknown) {
    if (
      typeof greetingMessage !== 'string' ||
      greetingMessage.trim().length > 2000
    ) {
      throw new BadRequestException(
        'greetingMessage must be text with at most 2000 characters',
      );
    }
    const settings = await this.prisma.facebookPageSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', greetingMessage: greetingMessage.trim() },
      update: { greetingMessage: greetingMessage.trim() },
    });
    return {
      greetingMessage: settings.greetingMessage,
      updatedAt: settings.updatedAt,
    };
  }

  async publishPagePost(
    message: unknown,
    image?: FacebookImage,
    includeMessengerLink = false,
    productId?: string,
  ) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new BadRequestException('Publication text is required');
    }
    if (typeof includeMessengerLink !== 'boolean') {
      throw new BadRequestException('includeMessengerLink must be a boolean');
    }
    let postMessage = message.trim();
    if (includeMessengerLink) {
      const messengerLink = this.graph.getMessengerLink();
      if (!postMessage.includes(messengerLink)) {
        postMessage += `\n\nÉcrivez-nous sur Messenger : ${messengerLink}`;
      }
    }
    if (postMessage.length > 5000) {
      throw new BadRequestException(
        'Publication text cannot exceed 5000 characters',
      );
    }
    if (productId !== undefined) {
      if (typeof productId !== 'string' || !productId.trim()) {
        throw new BadRequestException('productId must be a non-empty string');
      }
      const product = await this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, facebookPostId: true },
      });
      if (!product) {
        throw new BadRequestException('The product to publish does not exist');
      }
      if (product.facebookPostId) {
        throw new BadRequestException('The product has already been published');
      }
    }
    this.graph.ensureConfigured();
    const postId = await this.graph.publishPagePost(postMessage, image);
    if (productId) {
      const result = await this.prisma.product.updateMany({
        where: { id: productId, deletedAt: null, facebookPostId: null },
        data: { facebookPostId: postId, facebookPublishedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ServiceUnavailableException(
          'Facebook published the post, but the product record could not be updated',
        );
      }
    }
    return postId;
  }

  async publishProduct(productId: unknown) {
    if (typeof productId !== 'string' || !productId.trim()) {
      throw new BadRequestException('productId must be a non-empty string');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        nom: true,
        description: true,
        prix: true,
        imageUrl: true,
        facebookPostId: true,
      },
    });
    if (!product) {
      throw new NotFoundException('The product to publish does not exist');
    }
    if (product.facebookPostId) {
      throw new BadRequestException('The product has already been published');
    }
    if (typeof product.nom !== 'string' || !product.nom.trim()) {
      throw new BadRequestException('The product name cannot be published');
    }

    const description =
      typeof product.description === 'string' ? product.description.trim() : '';
    const price = product.prix.toString().trim();
    const message = [
      `Nouveau produit : ${product.nom.trim()}`,
      description,
      price ? `Prix : ${price}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const image = await readProductImageForFacebook(product.imageUrl);
    return this.publishPagePost(message, image, true, product.id);
  }

  verifyWebhook(mode: string | undefined, token: string | undefined, challenge: string | undefined) {
    const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
    if (!verifyToken) {
      throw new ServiceUnavailableException(
        'Facebook webhook verification is not configured',
      );
    }

    const expected = Buffer.from(verifyToken);
    const received = Buffer.from(token ?? '');
    const validToken =
      expected.length === received.length &&
      timingSafeEqual(expected, received);
    if (mode !== 'subscribe' || !validToken || !challenge) {
      throw new ForbiddenException('Invalid Facebook webhook verification');
    }
    return challenge;
  }

  async handleWebhook(payload: unknown) {
    this.graph.ensureConfigured();
    const events = this.extractEvents(payload);
    if (events.length === 0) return;

    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, nom: true, keywords: true },
    });

    for (const event of events) {
      await this.processEvent(event, products);
    }
  }

  private extractEvents(payload: unknown): IncomingFacebookEvent[] {
    if (!isRecord(payload) || payload.object !== 'page') return [];
    const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
    const events: IncomingFacebookEvent[] = [];

    for (const entry of getEntries(payload.entry)) {
      const entryPageId = getString(entry, 'id');
      if (pageId && entryPageId && entryPageId !== pageId) continue;

      for (const change of getEntries(entry.changes)) {
        const field = getString(change, 'field');
        const value = change.value;
        if (
          !field ||
          !isRecord(value) ||
          (field !== 'feed' && field !== 'live_comments')
        ) {
          continue;
        }

        const verb = getString(value, 'verb');
        if (verb && verb !== 'add') continue;
        if (field === 'feed' && getString(value, 'item') !== 'comment') {
          continue;
        }
        const senderId =
          getNestedId(value, 'from') ??
          getString(value, 'sender_id') ??
          getNestedId(value, 'sender');
        const commentId =
          getString(value, 'comment_id') ?? getString(value, 'id');
        const text =
          getString(value, 'message') ?? getString(value, 'text');
        if (
          !senderId ||
          !commentId ||
          !text ||
          senderId === pageId
        ) {
          continue;
        }

        events.push({
          channel: 'comment',
          eventId: commentId,
          senderId,
          text,
          commentId,
        });
      }

      for (const messagingEvent of getEntries(entry.messaging)) {
        const message = messagingEvent.message;
        if (!isRecord(message) || message.is_echo === true) continue;

        const senderId = getNestedId(messagingEvent, 'sender');
        const recipientId = getNestedId(messagingEvent, 'recipient');
        const eventId = getString(message, 'mid');
        const text = getString(message, 'text');
        if (
          !senderId ||
          !eventId ||
          !text ||
          senderId === pageId ||
          (pageId && recipientId && recipientId !== pageId)
        ) {
          continue;
        }

        events.push({ channel: 'messenger', eventId, senderId, text });
      }
    }

    return events;
  }

  private async processEvent(
    event: IncomingFacebookEvent,
    products: FacebookCatalogProduct[],
  ) {
    const match = matchFacebookProductMessage(event.text, products);
    if (match.kind === 'none') {
      const { greetingMessage } = await this.getPageSettings();
      const result = await this.ordersService.recordFacebookOutcome({
        channel: event.channel,
        eventId: event.eventId,
        senderId: event.senderId,
        status: 'greeting',
        replyText: greetingMessage || null,
      });
      if (!result.replyText || result.replySent) return;
      await this.sendReply(event, result.replyText);
      await this.ordersService.markFacebookReplySent(
        event.channel,
        event.eventId,
      );
      return;
    }

    let result;
    if (match.kind === 'match') {
      result = await this.ordersService.createFacebookReservation({
        channel: event.channel,
        eventId: event.eventId,
        senderId: event.senderId,
        items: match.items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });
    } else {
      const replyText =
        match.kind === 'ambiguous'
          ? 'Merci d’indiquer un seul produit et sa quantité par message. Pour plusieurs produits, envoyez un message distinct pour chacun.'
          : 'La quantité doit être un nombre entier supérieur à zéro.';
      result = await this.ordersService.recordFacebookOutcome({
        channel: event.channel,
        eventId: event.eventId,
        senderId: event.senderId,
        status: match.kind,
        replyText,
      });
    }

    if (!result.replyText || result.replySent) return;
    await this.sendReply(event, result.replyText);
    await this.ordersService.markFacebookReplySent(
      event.channel,
      event.eventId,
    );
  }

  private async sendReply(event: IncomingFacebookEvent, replyText: string) {
    if (event.channel === 'comment' && event.commentId) {
      await this.graph.sendCommentPrivateReply(
        event.commentId,
        replyText,
      );
    } else {
      await this.graph.sendMessengerReply(event.senderId, replyText);
    }
  }
}
