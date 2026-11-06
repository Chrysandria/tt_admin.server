export class Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'reserved' | 'payed' | 'canceled';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
