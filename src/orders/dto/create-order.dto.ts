export class CreateOrderItemDto {
  product_id: string;
  quantity: number;
}

export class CreateOrderDto {
  items?: CreateOrderItemDto[];
  product_id?: string;
  quantity?: number;
  status?: 'reserved' | 'payed' | 'canceled';
}
