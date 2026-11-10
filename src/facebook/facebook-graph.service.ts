import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Express } from 'express';

interface FacebookGraphConfig {
  pageId: string;
  pageAccessToken: string;
  version: string;
}

@Injectable()
export class FacebookGraphService {
  ensureConfigured() {
    this.getConfig();
  }

  async sendCommentPrivateReply(commentId: string, message: string) {
    const config = this.getConfig();
    await this.post(
      `${encodeURIComponent(commentId)}/private_replies`,
      config,
      { message },
    );
  }

  async sendMessengerReply(recipientId: string, message: string) {
    const config = this.getConfig();
    await this.post(`${encodeURIComponent(config.pageId)}/messages`, config, {
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text: message }),
      messaging_type: 'RESPONSE',
    });
  }

  getMessengerLink() {
    const config = this.getConfig();
    return `https://m.me/${encodeURIComponent(config.pageId)}`;
  }

  async publishPagePost(message: string, image?: Express.Multer.File) {
    const config = this.getConfig();
    if (image) {
      const contentType = this.getImageContentType(image.buffer);
      const body = new FormData();
      body.set('message', message);
      body.set('published', 'true');
      body.set('access_token', config.pageAccessToken);
      body.set(
        'source',
        new Blob([new Uint8Array(image.buffer)], { type: contentType }),
        `publication.${contentType.split('/')[1]}`,
      );
      return this.request(
        `${encodeURIComponent(config.pageId)}/photos`,
        config,
        { method: 'POST', body },
      );
    }

    return this.post(`${encodeURIComponent(config.pageId)}/feed`, config, {
      message,
    });
  }

  private getConfig(): FacebookGraphConfig {
    const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
    const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
    const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim();
    if (
      !pageId ||
      !pageAccessToken ||
      !version ||
      !/^v\d+\.\d+$/.test(version)
    ) {
      throw new ServiceUnavailableException(
        'Facebook Page integration is not fully configured',
      );
    }
    return { pageId, pageAccessToken, version };
  }

  private async post(
    edge: string,
    config: FacebookGraphConfig,
    fields: Record<string, string>,
  ) {
    const body = new URLSearchParams({
      ...fields,
      access_token: config.pageAccessToken,
    });
    return this.request(edge, config, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  private async request(
    edge: string,
    config: FacebookGraphConfig,
    init: RequestInit,
  ) {
    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${config.version}/${edge}`,
        {
          ...init,
          signal: AbortSignal.timeout(8000),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Could not reach the Facebook Graph API',
      );
    }

    const responseText = await response.text();
    let payload: unknown;
    if (responseText) {
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        if (response.ok) return;
      }
    }
    if (!response.ok) {
      const errorMessage =
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'object' &&
        payload.error !== null &&
        'message' in payload.error &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : `HTTP ${response.status}`;
      throw new ServiceUnavailableException(
        `Facebook Graph API refused the request: ${errorMessage}`,
      );
    }
    return payload;
  }

  private getImageContentType(buffer: Buffer) {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    ) {
      return 'image/png';
    }
    throw new BadRequestException(
      'Publication image must be a valid JPEG or PNG file',
    );
  }
}
