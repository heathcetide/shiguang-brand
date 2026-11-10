import { db } from "../../storage/db.js";
import { createCommunityRouter } from "./route.js";
import { CommunityService } from "./service.js";
import { SqliteCommunityRepository } from "./sqliteRepository.js";

const repository = new SqliteCommunityRepository(db);
export const communityService = new CommunityService(repository);

export default createCommunityRouter(communityService);
