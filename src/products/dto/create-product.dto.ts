export class CreateProductColorDto {
  name: string;
  initial: number;
  available?: number;
}

export class CreateProductDto {
  nom: string;
  description?: string;
  keywords?: string[];
  prix: string;
  initial: number;
  colors?: CreateProductColorDto[];
}
