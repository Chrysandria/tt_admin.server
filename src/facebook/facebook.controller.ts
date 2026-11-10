import {
  BadRequestException,
  Controller,
  Body,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorator/public.decorator.js';
import { AdminGuard } from '../users/admin.guard.js';
import { FacebookService } from './facebook.service.js';
import { isValidMetaSignature } from './facebook-signature.js';

interface PagePostFields {
  message?: string;
  includeMessengerLink?: string | boolean;
}

@Controller('facebook')
export class FacebookController {
  constructor(private readonly facebookService: FacebookService) {}

  @Public()
  @SkipThrottle()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ) {
    return this.facebookService.verifyWebhook(mode, token, challenge);
  }

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      throw new ServiceUnavailableException(
        'Facebook webhook signature verification is not configured',
      );
    }
    if (!isValidMetaSignature(request.rawBody, signature, appSecret)) {
      throw new UnauthorizedException('Invalid Facebook webhook signature');
    }

    await this.facebookService.handleWebhook(request.body);
    return { received: true };
  }

  @UseGuards(AdminGuard)
  @Get('settings')
  settings() {
    return this.facebookService.getPageSettings();
  }

  @UseGuards(AdminGuard)
  @Patch('settings')
  updateSettings(@Body() body: { greetingMessage?: unknown }) {
    return this.facebookService.updateGreetingMessage(body?.greetingMessage);
  }

  @UseGuards(AdminGuard)
  @Post('posts')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  async publish(
    @Body() fields: PagePostFields,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    const includeMessengerLink = this.parseMessengerLinkOption(
      fields.includeMessengerLink,
    );
    await this.facebookService.publishPagePost(
      fields.message,
      image,
      includeMessengerLink,
    );
    return { published: true };
  }

  private parseMessengerLinkOption(value: string | boolean | undefined) {
    if (value === undefined || value === false || value === 'false') {
      return false;
    }
    if (value === true || value === 'true') return true;
    throw new BadRequestException('includeMessengerLink must be a boolean');
  }
}
