# Deployment Assistant

A web app with a chat window. You type a request such as `deploy sample-app version v2 to staging`, confirm it, and the assistant deploys the app to a Kubernetes cluster. Then you can ask about its health, CPU and memory in plain English.

It runs against a local [kind](https://kind.sigs.k8s.io/) cluster and against AWS EKS with the same code. Only the kubeconfig context changes. The Terraform code that creates the EKS cluster is in [terraform/](terraform/).

- **Design and trade-offs:** [DESIGN.md](DESIGN.md)
- **EKS cluster with Terraform:** [terraform/README.md](terraform/README.md)

## What you need

| Tool | Version used | Needed for |
|---|---|---|
| Node.js | 24 (see [.nvmrc](.nvmrc)) | The assistant |
| Docker | 29 | The local cluster and the sample app images |
| kind | 0.33 | The local cluster |
| kubectl | 1.37 | Setup scripts only. The app itself never runs `kubectl` |
| Terraform, AWS CLI | 1.16, 2.x | Only for the EKS cluster |

**Why Node.js 24 and TypeScript.** Node.js is what I work in every day, and Kubernetes has an official client library for it. TypeScript catches wrong field names in Kubernetes objects before the code runs. Node 24 runs `.ts` files directly, so there is no build step. Node's built-in test runner and built-in SQLite keep the project to three runtime dependencies: `express`, `@kubernetes/client-node` and `yaml`.

## Run it locally

This takes about five minutes on a first run. Most of that is Docker downloading images.

```bash
npm install
./scripts/kind-up.sh        # creates the cluster, about 2 to 3 minutes
cp .env.example .env
npm start
```

Then open <http://127.0.0.1:3000>.

`kind-up.sh` creates a kind cluster named `deploy-assistant` and puts into it what the assistant expects to find:

- the sample app images `sample-app:v1`, `sample-app:v2` and a broken `sample-app:v3` that crashes on start
- the `staging` and `prod` namespaces
- metrics-server, started with `--kubelet-insecure-tls`, which kind needs

The script is safe to run again. CPU and memory numbers appear one to two minutes after a pod starts, because metrics-server needs that long to collect them.

## Ten messages to try

Type your name in the top right corner first; it is stored with each deployment.

1. `deploy sample-app version v1 to staging`, then click **Confirm**
2. `is it healthy?`
3. `deploy sample-app version v2 to staging`
4. `how much cpu and ram is it using?`
5. `which pod is using the most memory?`
6. `how are the nodes doing?`
7. `scale staging to 5 replicas`
8. `roll back staging`
9. `full status of prod`
10. `show my last 5 deployments`

`help` lists everything the assistant understands. `deploy it` shows how it asks for missing details instead of guessing.

## Seeing it handle problems

**A version that crashes.** `deploy sample-app version v3 to staging`. The rollout stops after the first crash and the reply quotes the last log line. The old pods keep serving, and `roll back staging` returns to them.

**An image that does not exist.** `deploy sample-app version v9 to staging`.

**High memory.** Ask one pod to hold 215 Mi for three minutes, then ask `is it healthy?` after about a minute. The limit is 256 Mi and the threshold is 85%, so the status becomes DEGRADED.

```bash
kubectl --context kind-deploy-assistant get --raw \
  "/api/v1/namespaces/staging/services/sample-app:80/proxy/stress?memory=215&hold=180"
```

Use `memory=400` to go over the limit; the pod is then killed and the assistant reports the OOMKill. `cpu=60` uses CPU for 60 seconds.

**No metrics-server.** Stop it, then ask `how much cpu and ram is staging using?`. The assistant says the numbers are not available. It never shows zeros.

```bash
kubectl --context kind-deploy-assistant -n kube-system scale deployment metrics-server --replicas=0
kubectl --context kind-deploy-assistant -n kube-system scale deployment metrics-server --replicas=1   # bring it back
```

**Two people at once.** Open the page in two tabs. Ask each for a different deploy to staging, then click Confirm in both. One rollout runs; the other tab is told a deployment is already in progress.

**Cluster not reachable.** Stop the cluster with `docker stop deploy-assistant-control-plane` and ask anything. Start it again with `docker start deploy-assistant-control-plane`.

## Tests

```bash
npm test             # unit tests; no cluster needed
npm run typecheck    # TypeScript type check
```

The tests replace the cluster with an in-memory fake ([tests/helpers/fakeGateway.ts](tests/helpers/fakeGateway.ts)). They cover intent parsing, unit conversion, health evaluation, deploy, roll back, scaling, the one-change-at-a-time lock and every failure message.

## Settings

| File | What it holds |
|---|---|
| [config/app.config.yaml](config/app.config.yaml) | Environment names, DEGRADED thresholds (with per-environment overrides), timeouts, and the app's replicas, port, requests and limits |
| `.env` (copy of [.env.example](.env.example)) | Port, kubeconfig context, database file, image registry. Nothing in it is secret |
| [k8s/templates/](k8s/templates/) | The Deployment and Service the assistant creates, with readiness and liveness probes on `/health` |

## Where things are

```
frontend/        the chat page (plain HTML, CSS and JavaScript)
src/api/         web routes and error messages
src/agent/       understands messages, keeps one conversation per tab, holds the Confirm step
src/services/    deploy, roll back, scale, health, CPU and memory, history
src/cluster/     the only code that uses the Kubernetes library
config/          thresholds, timeouts, environments
k8s/             manifest templates and local cluster files
sample-app/      the small app that gets deployed
terraform/       the EKS cluster
tests/           unit tests
```

## Clean up

```bash
./scripts/kind-down.sh
```
