import { createAuthAccountRouter } from "../modules/authAccount/index.js";
import { createAuthRouter } from "./authRouter.js";

export default createAuthRouter(createAuthAccountRouter());
