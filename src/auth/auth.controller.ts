import {
  Controller,
  Body,
  Get,
  HttpCode,
  InternalServerErrorException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthenticatedUser, AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from '../common/decorator/public.decorator.js';

const AUTH_COOKIE = 'access_token';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('csrf-token')
  csrfToken(@Req() request: Request, @Res() response: Response) {
    if (!request.csrfToken) {
      throw new InternalServerErrorException('CSRF protection is unavailable');
    }
    return response.json({ csrfToken: request.csrfToken() });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(loginDto);
    response.cookie(AUTH_COOKIE, result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      ...(result.stayConnected ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
    });
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(AUTH_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }

  @Get('me')
  me(@Req() request: Request & { user: AuthenticatedUser }) {
    return request.user;
  }
}
