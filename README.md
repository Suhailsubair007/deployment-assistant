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

**Why Node.js 24 and TypeScript.** Node.js is what I work in every day, and Kubernetes has an official client library for it. TypeScript catches wrong field names in Kubernetes objects before the code runs. Node 24 runs `.ts` files directly, so the server has no build step. Node's built-in test runner and built-in SQLite keep the server's own runtime dependencies to three: `express`, `@kubernetes/client-node` and `yaml`. Three more, `@langchain/langgraph`, `@langchain/core` and `openai`, are used only when OpenAI reads the chat messages (see [Understanding messages](#understanding-messages-rules-or-openai)).

**The page** is a Next.js app (React, Tailwind and shadcn/ui components) in [frontend/](frontend/). `npm run build` turns it into plain HTML, CSS and JavaScript files once, and the same Express server serves them. So there is still one process and one address, and no Next.js server runs.

## Run it locally

This takes about five minutes on a first run. Most of that is Docker downloading images.

```bash
npm install
npm run build               # builds the page into frontend/out, about 10 seconds
./scripts/kind-up.sh        # creates the cluster, about 2 to 3 minutes
cp .env.example .env
npm start
```

Then open <http://127.0.0.1:3000>.

To work on the page with hot reload, keep `npm start` running and run `npm run dev:web` in a second terminal, then open <http://127.0.0.1:3001>. Run `npm run build` again when you are done, because `npm start` serves the built files.

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

## Understanding messages: rules or OpenAI

The assistant can read chat messages in two ways. It picks one when it starts, and says which one in the terminal and at the end of the `help` reply.

| | Rules (the default) | OpenAI |
|---|---|---|
| Turned on by | nothing | `OPENAI_API_KEY` in `.env` |
| Understands | the phrasings above and close variants | casual language, for example `push v2 out to staging` or `bump staging up to five pods` |
| Needs | nothing | network access and an OpenAI API key |

**The app works without a key.** It then prints `Messages are read by built-in rules. The LLM is not configured (OPENAI_API_KEY is not set).`

**To turn OpenAI on**, add the key to `.env` and start the app again. `.env` is not committed.

```bash
OPENAI_API_KEY=sk-...
```

The model name, the timeout for one call and the pause after a failure are in [config/app.config.yaml](config/app.config.yaml) under `llm`.

**If OpenAI cannot be used** (wrong key, no credit, timeout, network down), the rules read the message instead and the reply says so: `Note: OpenAI rejected the API key. I read this message with my built-in rules instead.` The terminal shows the reason with OpenAI's status code. OpenAI is tried again after one minute.

**What does not change.** OpenAI only reads the message. It picks one entry from a fixed list (deploy, scale, roll back, health and so on) and fills in details. The server checks every value, asks for what is missing, and every change still needs **Confirm**. [DESIGN.md](DESIGN.md) section 10 has the details.

**Try both modes.**

1. *Rules.* Start without a key and type `push v2 out to staging`. The rules do not know "push", so this is not read as a deploy.
2. *OpenAI.* Add your key, start again and type the same message. The reply is the deploy summary with Confirm and Cancel. Other things to try: `is everything alright in prod?`, `undo the last release on staging`, `bump staging up to five pods`, and `ship v2` followed by `the staging one please`.
3. *Fallback.* Set `OPENAI_API_KEY=sk-wrong`, start again and type `how are the nodes doing?`. You get the answer and the note above.

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

## Run it against EKS

[terraform/README.md](terraform/README.md) creates the cluster. After that, the same app runs against it with two settings changed:

```bash
# A kubeconfig context that uses the assistant's limited IAM role
$(terraform -chdir=terraform output -raw assistant_kubeconfig_command)

# Put the sample app images where the cluster can pull them from
./scripts/push-sample-app.sh "$(terraform -chdir=terraform output -raw image_registry)"

KUBE_CONTEXT=eks-assistant \
IMAGE_REGISTRY="$(terraform -chdir=terraform output -raw image_registry)" \
npm start
```

No code changes. `KUBE_CONTEXT` picks the cluster, and `IMAGE_REGISTRY` is put in front of image names, because EKS cannot see images that exist only on your laptop.

## Check the assistant's permissions locally

On EKS the assistant works with a small set of permissions in the `staging` and `prod` namespaces. The same rules can be tried on kind:

```bash
./scripts/kind-restricted-context.sh
KUBE_CONTEXT=kind-deploy-assistant-restricted npm start
```

Everything in the chat still works. Deleting, reading Secrets and other namespaces are refused by Kubernetes, which you can see with `kubectl --context kind-deploy-assistant-restricted auth can-i delete deployments -n staging`.

## Tests

```bash
npm test             # unit tests; no cluster needed
npm run typecheck    # TypeScript type check of the server
npm run build        # builds the page; this also type-checks it
```

The tests replace the cluster with an in-memory fake ([tests/helpers/fakeGateway.ts](tests/helpers/fakeGateway.ts)). They cover intent parsing, unit conversion, health evaluation, deploy, roll back, scaling, the one-change-at-a-time lock and every failure message.

The OpenAI path is tested without a key and without the network: the tests give the workflow a pretend model answer, and replace the network call under the real OpenAI library. They cover the checks on what the model says, every way a call can fail, and the fallback to the rules.

The page's logic that needs no browser is tested too ([frontend/tests/](frontend/tests/)): the API call and its error sentences, how a reply is cut into lines and tables, the Confirm and Cancel notes, the pod counts, the steps of a rollout, and the mood of Buddy (the face in the chat). The React components themselves have no automated tests; they were checked by hand in the browser.

## Settings

| File | What it holds |
|---|---|
| [config/app.config.yaml](config/app.config.yaml) | Environment names, DEGRADED thresholds (with per-environment overrides), timeouts, the OpenAI model, and the app's replicas, port, requests and limits |
| `.env` (copy of [.env.example](.env.example)) | Port, kubeconfig context, database file, image registry, and the optional `OPENAI_API_KEY`. The key is the only secret; `.env` is not committed |
| [k8s/templates/](k8s/templates/) | The Deployment and Service the assistant creates, with readiness and liveness probes on `/health` |

## Where things are

```
frontend/        the chat page (Next.js with shadcn/ui; built into frontend/out)
src/api/         web routes and error messages
src/agent/       understands messages (rules, or OpenAI through LangGraph), keeps one conversation per tab, holds the Confirm step
src/services/    deploy, roll back, scale, health, CPU and memory, history
src/cluster/     the only code that uses the Kubernetes library
config/          thresholds, timeouts, environments
k8s/             manifest templates and local cluster files
sample-app/      the small app that gets deployed
terraform/       the EKS cluster
tests/           unit tests
```

## What is not done

- **`terraform plan` and `terraform apply` have not been run against AWS yet.** The Terraform code passes `fmt`, `validate` and `tflint`, and the assistant's Kubernetes permissions were tested on kind, but nothing has been created in an AWS account so far.
- **OpenAI mode is checked by hand only.** With a real key it read a dozen casual messages correctly. The automated tests use pretend model answers, so how well the real model reads messages in general is not measured.
- **Bonus features** from the test are not built: automatic rollback, charts, autoscaler status, fix suggestions, a logs command, login, Helm support, and running the assistant inside the cluster.
- **No login.** The name in the top right corner is typed by the user and stored as "requested by"; it does not prove who they are.
- **One backend instance.** Conversations and rollout progress are kept in memory, and the one-change-at-a-time lock is a local SQLite file.
- **No PodDisruptionBudget** in the Deployment template.

## Clean up

```bash
./scripts/kind-down.sh
```
