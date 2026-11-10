import { withAuthGuard } from "@/components/RequireAuth";
import CookingQueueScreen from "@/screens/cooking-queue";

export default withAuthGuard(CookingQueueScreen);
