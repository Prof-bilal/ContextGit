import express from "express";

const app = express();
const router = express.Router();

app.get("/health", (req, res) => res.json({ status: "ok" }));
router.post("/widgets/:id", (req, res) => res.json({ id: req.params.id }));
app.delete("/widgets/:id", (req, res) => res.status(204).end());

export default app;
