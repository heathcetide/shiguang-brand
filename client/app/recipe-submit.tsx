import { withAuthGuard } from "@/components/RequireAuth";
import RecipeSubmitScreen from "@/screens/recipe-submit";

export default withAuthGuard(RecipeSubmitScreen);
