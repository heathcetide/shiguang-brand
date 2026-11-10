import { z } from "zod";

export const communityBookmarkResponseSchema = z.object({ bookmarked: z.boolean() });
export type CommunityBookmarkResponse = z.infer<typeof communityBookmarkResponseSchema>;

export function createCommunityOpenApiDocument() {
  const response = { description: "Confirmed bookmark state for the authenticated account", content: { "application/json": { schema: { $ref: "#/components/schemas/CommunityBookmarkResponse" } } } };
  const errors = {
    "400": { description: "Invalid post ID" },
    "401": { description: "Authentication required" },
    "403": { description: "Account disabled" },
    "404": { description: "Post deleted or unavailable" },
  };
  return {
    openapi: "3.1.0",
    info: { title: "DietDigiDose Community Bookmarks API", version: "1.0.0", description: "Account-private, independent post bookmarks. Post detail includes is_bookmarked (false for anonymous viewers). No recipe favorite changes." },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/community/posts/{id}/bookmark": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        put: { operationId: "saveCommunityPost", description: "Idempotently save an available post. Repeated saves do not toggle state.", responses: { "200": response, ...errors } },
        delete: { operationId: "unsaveCommunityPost", description: "Idempotently remove an available post bookmark. Repeated removals do not toggle state.", responses: { "200": response, ...errors } },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: { CommunityBookmarkResponse: z.toJSONSchema(communityBookmarkResponseSchema, { target: "draft-2020-12" }) },
    },
  };
}
