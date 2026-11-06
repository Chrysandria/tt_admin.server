export class CreateOrderDto {
  product_id: string;
  quantity: number;
  status?: 'reserved' | 'payed' | 'canceled';
}
