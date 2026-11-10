import { KitchenwareService } from "../kitchenware/service.js";
import type { KitchenwareRepository } from "../kitchenware/repository.js";
import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";
import { maintenanceRuleTables } from "./inputSnapshot.js";

/** Reuse the live evaluator while guaranteeing that every read comes from captured data. */
export function snapshotKitchenware(snapshot: MaintenanceInputSnapshot) {
  for (const table of [...maintenanceRuleTables,"kitchenware_items","recipes"]) {
    if (!Array.isArray(snapshot.data[table])) throw new Error(`Missing maintenance input: ${table}`);
  }
  const data = snapshot.data;
  const roleRank = (role: unknown) => role === "required" ? 0 : role === "optional" ? 1 : 2;
  const catalogs = data.kitchenware_catalog;
  const catalog = (id: unknown) => catalogs.find(row => Number(row.id) === Number(id));
  const unavailable = async (): Promise<never> => { throw new Error("Snapshot kitchenware evaluator is read-only"); };
  const repository: KitchenwareRepository = {
    listCatalog: async () => catalogs.filter(row => row.quality_status === "trusted"),
    capabilitiesForCatalog: async id => data.kitchenware_catalog_capabilities.filter(row => Number(row.catalog_id) === id).flatMap(row => {
      const capability = data.kitchenware_capabilities.find(value => value.code === row.capability_code);
      return capability ? [{ ...capability,constraints_json: row.constraints_json }] : [];
    }),
    requirementsForRecipe: async id => data.recipe_kitchenware_requirements.filter(row => Number(row.recipe_id) === id).sort((a,b) => roleRank(a.role)-roleRank(b.role) || Number(a.id)-Number(b.id)).map(row => ({ ...row,
      catalog_id: catalog(row.catalog_id)?.id ?? null,catalog_name: catalog(row.catalog_id)?.name ?? null,
    })),
    ownedItems: async userId => data.kitchenware_items.filter(row => Number(row.user_id) === userId && !row.deleted_at && row.status !== "维修中"),
    substitutionsForCatalog: async id => data.kitchenware_substitutions.filter(row => Number(row.source_catalog_id) === id && catalog(row.substitute_catalog_id))
      .map(row => ({ ...row,id: Number(row.substitute_catalog_id),name: catalog(row.substitute_catalog_id)!.name })),
    substitutionFor: async (sourceId,ownedIds) => {
      const relation = data.kitchenware_substitutions.filter(row => Number(row.source_catalog_id) === sourceId && ownedIds.includes(Number(row.substitute_catalog_id))
        && row.relation_type !== "forbidden" && catalog(row.substitute_catalog_id)).sort((a,b) => Number(a.relation_type !== "equivalent")-Number(b.relation_type !== "equivalent"))[0];
      return relation ? { ...relation,name: catalog(relation.substitute_catalog_id)!.name } : null;
    },
    recipeAvailable: async id => data.recipes.some(row => Number(row.id) === id && row.status === "approved" && !row.deleted_at),
    listItems: unavailable,listCapabilities: unavailable,findOwnedItem: unavailable,
    createItem: unavailable,updateItem: unavailable,maintainItem: unavailable,removeItem: unavailable,upsertMappingReview: unavailable,
  };
  const service = new KitchenwareService(repository);
  return { requirements: service.requirements.bind(service),evaluateRequirements: service.evaluateRequirements.bind(service) };
}
