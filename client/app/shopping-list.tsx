import { withAuthGuard } from "@/components/RequireAuth";
import ShoppingListScreen from "@/screens/shopping-list";

export default withAuthGuard(ShoppingListScreen);
