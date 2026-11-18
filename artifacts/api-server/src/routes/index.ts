import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import energyRouter from "./energy.js";
import accountRouter from "./account.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(energyRouter);
router.use(accountRouter);

export default router;