import type { UserType } from '../../generated/prisma/client.js';

export class CreateUserDto {
  email: string;
  type: UserType;
}
