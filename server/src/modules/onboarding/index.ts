import { db } from "../../storage/db.js";
import { createOnboardingRouter } from "./route.js";
import { OnboardingService } from "./service.js";
import { SqliteOnboardingRepository } from "./sqliteRepository.js";

export const onboardingService = new OnboardingService(new SqliteOnboardingRepository(db));
export default createOnboardingRouter(onboardingService);
