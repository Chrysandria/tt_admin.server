import type { UserType } from '../../generated/prisma/client.js';

export class UpdateUserDto {
  email?: string;
  nom?: string;
  profil?: string;
  type?: UserType;
  password?: string;
}
