export type ShoppingItemInput = {
  clientId?: string;
  name: string;
  amount: string;
  category: string;
  checked: boolean;
  purchaseDate?: string;
  storageLocation?: string;
};

export type ShoppingItemUpdate = Partial<ShoppingItemInput> & {
  version: number;
};

export type ShoppingItem = {
  id: string;
  clientId?: string;
  name: string;
  amount: string;
  category: string;
  checked: boolean;
  purchaseDate?: string;
  storageLocation?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ShoppingImportInput = {
  importKey: string;
  items: ShoppingItemInput[];
};
