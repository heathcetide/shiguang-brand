import { withAuthGuard } from "@/components/RequireAuth";
import CookingModeScreen from "@/screens/cooking-mode";

export default withAuthGuard(CookingModeScreen);
