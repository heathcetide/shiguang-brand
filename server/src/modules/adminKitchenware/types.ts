export type Row = Record<string, unknown>;

export type CatalogInput = {
  name: string;
  category: string;
  aliases: string[];
  cookingMethods: string[];
  careNote: string | null;
};

export type CatalogQuery = { search: string; category: string };
export type AssetQuery = { search: string; category: string; status: string };

export type AuditContext = {
  adminUserId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type WriteResult = { kind: "updated"; item: Row } | { kind: "missing" } | { kind: "duplicate" };
