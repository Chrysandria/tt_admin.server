export class Order {
  id: string;
  status: 'reserved' | 'payed' | 'canceled';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  items: OrderItem[];
}

export class OrderItem {
  id: string;
  productId: string;
  quantity: number;
}
