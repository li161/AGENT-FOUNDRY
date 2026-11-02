# AGENT FOUNDRY 2.0

An immersive 3D workspace to learn Harness engineering and Agent distillation by running real experiments.

## Product loop

1. Explore a Three.js world with selectable, repositionable digital humans.
2. Compose a dependency graph by selecting team members.
3. Submit a task to the Node.js Harness API. The API invokes DeepSeek, schedules dependency-ready agents concurrently, and records task states/results.
4. Export successful task outputs as JSONL SFT samples.
5. Fine-tune a local Student causal language model with the Python training script.

## Run locally

```bash
npm install
npm run dev
```

In another terminal:

```cp .env.example .env
# Set DEEPSEEK_API_KEY in .env (server only)
npm run api
```

Set `VITE_AGENT_API=http://localhost:8787` in a local `.env.local` if needed. The UI defaults to the deployed API URL only if you configure it; never put model keys in Vite variables.

## GitHub Pages

The workflow builds the static Vue app and publishes `dist/` to Pages. In repository Settings → Pages, set Source to **GitHub Actions**. Pages only hosts the front end; deploy `services/api` separately (Render, Railway, Fly.io, etc.) and set the API URL in the frontend build environment.

## API

- `GET /health`
- `POST /api/chat` body: `{ message, agents: [{ id, name, role, instructions, dependsOn }] }`
- `GET /api/tasks/:id`

The first-stage distillation is text-response SFT from successful task results. Structured tool-call policy distillation, held-out evaluation, and online Student deployment remain future work.

## Training

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r training/requirements.txt
python training/train_sft.py --input ./foundry-sft.jsonl --output ./artifacts/student-v1
```
