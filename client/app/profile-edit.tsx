import { withAuthGuard } from "@/components/RequireAuth";
import ProfileEditScreen from "@/screens/profile-edit";

export default withAuthGuard(ProfileEditScreen);
