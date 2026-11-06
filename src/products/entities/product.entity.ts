export class Product {
  id: string;
  nom: string;
  prix: string;
  imageUrl: string | null;
  initial: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
