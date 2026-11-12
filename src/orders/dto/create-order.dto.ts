export class CreateOrderItemDto {
  product_id: string;
  product_color_id?: string;
  quantity: number;
}

export class CreateOrderDto {
  items?: CreateOrderItemDto[];
  product_id?: string;
  product_color_id?: string;
  quantity?: number;
  status?: 'reserved' | 'payed' | 'canceled';
  customer_name?: string | null;
  delivery_address?: string | null;
  customer_phone?: string | null;
  delivered?: boolean;
}
