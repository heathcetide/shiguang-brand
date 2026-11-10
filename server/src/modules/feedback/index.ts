import { db } from "../../storage/db.js";
import { createFeedbackRouter } from "./route.js";
import { FeedbackService } from "./service.js";
import { SqliteFeedbackRepository } from "./sqliteRepository.js";

const repository = new SqliteFeedbackRepository(db);
const service = new FeedbackService(repository);

export default createFeedbackRouter(service);
