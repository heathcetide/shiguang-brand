import { withAuthGuard } from "@/components/RequireAuth";
import PostCreateScreen from "@/screens/post-create";

export default withAuthGuard(PostCreateScreen);
