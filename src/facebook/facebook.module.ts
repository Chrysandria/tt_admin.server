import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FacebookController } from './facebook.controller.js';
import { FacebookGraphService } from './facebook-graph.service.js';
import { FacebookService } from './facebook.service.js';
import { AdminGuard } from '../users/admin.guard.js';

@Module({
  imports: [OrdersModule, PrismaModule],
  controllers: [FacebookController],
  providers: [AdminGuard, FacebookGraphService, FacebookService],
  exports: [FacebookGraphService],
})
export class FacebookModule {}
