# Deployment Assistant

A web app with a chat window. You type a request such as `deploy sample-app version v2 to staging`, confirm it, and the assistant deploys the app to a Kubernetes cluster. Then you can ask about its health, CPU and memory in plain English.

It can also create a service from a project folder on your own machine. `create a service` starts a short list of questions: the folder, a name, the port, CPU, memory and so on. After you click Confirm, the assistant builds the image from the folder's Dockerfile, hands it to the cluster and starts the pods. Later, `edit <name> in <environment>` changes one setting, and `deploy <name> to <environment>` builds and deploys the next version.

It runs against a local [kind](https://kind.sigs.k8s.io/) cluster and against AWS EKS with the same code. Only the kubeconfig context changes. The Terraform code that creates the EKS cluster is in [terraform/](terraform/).

One thing to know before you start: to build an image, the assistant runs Docker on your machine, and a Dockerfile can run anything. So this is a tool for the person who runs it, on their own machine. It is not a shared service. [What is not done](#what-is-not-done) and [DESIGN.md](DESIGN.md) section 4 say more.

- **Design and trade-offs:** [DESIGN.md](DESIGN.md)
- **EKS cluster with Terraform:** [terraform/README.md](terraform/README.md)

## What you need

| Tool | Version used | Needed for |
|---|---|---|
| Node.js | 24 (see [.nvmrc](.nvmrc)) | The assistant |
| Docker | 29 | The local cluster and the sample app images. The assistant also runs `docker build` itself when it creates or rebuilds a service, so Docker must be running |
| kind | 0.33 | The local cluster. On kind the assistant also runs `kind load docker-image`, to copy an image it built into the cluster |
| kubectl | 1.37 | Setup scripts only. The app itself never runs `kubectl` |
| Terraform, AWS CLI | 1.16, 2.x | Only for EKS. You run them to create the cluster. When a service is created on EKS the assistant runs them too: `terraform` to create the service's image repository, and `aws` to log Docker in to it |

`docker`, `kind`, `aws` and `terraform` are the only four programs the assistant starts. It starts them from one file, with a list of arguments and no shell.

**Why Node.js 24 and TypeScript.** Node.js is what I work in every day, and Kubernetes has an official client library for it. TypeScript catches wrong field names in Kubernetes objects before the code runs. Node 24 runs `.ts` files directly, so the server has no build step. Node's built-in test runner and built-in SQLite keep the server's own runtime dependencies to three: `express`, `@kubernetes/client-node` and `yaml`. Three more, `@langchain/langgraph`, `@langchain/core` and `openai`, are used only when OpenAI reads the chat messages (see [Understanding messages](#understanding-messages-rules-or-openai)). Starting programs uses Node's built-in `child_process`, so building images added no dependency.

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

## Create a service from a folder

Type `create a service`. The assistant asks one thing at a time. Type `default` to take the value it suggests, or `cancel` to stop.

| Question | Suggested value | Rule |
|---|---|---|
| Project folder | none | A folder inside your home folder that contains a `Dockerfile` |
| Name | the folder's name | Lowercase letters, digits and single dashes, at most 40 characters |
| Environment | none | `staging` or `prod`; the name must be free there |
| Port | the `EXPOSE` line of the Dockerfile | 1024 to 65535 |
| Health path | `/health` | Must answer 200 when the app is ready |
| CPU, then memory | `100m to 500m`, `128Mi to 256Mi` | The reserved amount and the maximum. One amount sets both |
| Replicas, then the most replicas | 2, then 10 | The second is only the limit for `scale`. There is no autoscaler |
| Variables | none | `NAME=value` separated by spaces. Plain text only: no passwords or keys |

To try it, use the second small app in this repository, [greeter-app/](greeter-app/). It listens on port 3000 and says a greeting it reads from a variable.

1. `create a service`
2. the full path of the `greeter-app` folder, for example `~/code/deployment-assistant/greeter-app`
3. `default` for the name (`greeter-app`), then `staging`
4. `default` for the port (3000, read from the Dockerfile), and `default` five more times
5. `GREETING=Namaste`
6. Read the summary and click **Confirm**

The progress line then shows the image being built, handed to the cluster, and the pods starting. Afterwards:

- `edit greeter-app in staging` changes one setting (CPU, memory, port, health path, variables or the scale limit) and keeps the image.
- `deploy greeter-app to staging` builds the folder again as the next version (`v2`, `v3`, ...).
- `deploy greeter-app version v1 to staging`, `scale greeter-app in staging to 3` and `roll back greeter-app in staging` work as they do for `sample-app`.

A third small app, [counter-app/](counter-app/), is there to try the health path question. It listens on port 4000 and its health check is on `/healthz`, so answer that question with `/healthz` instead of `default`. With `default` the pods never become ready, and the assistant reports that the rollout did not finish.

To see the greeting the service answers with:

```bash
kubectl --context kind-deploy-assistant get --raw \
  "/api/v1/namespaces/staging/services/greeter-app:80/proxy/"
```

Three things to know:

- **Nothing is built or changed before Confirm.** The questions only collect answers.
- **One thing at a time.** If you type another request in the middle of the questions, the assistant does not act on it. It says so and repeats the question.
- **The answers stay on your machine.** While the questions are open, each answer is checked by fixed rules and is not sent to OpenAI, even when a key is set.

The default answers and the folders you may build from are in [config/app.config.yaml](config/app.config.yaml) under `serviceDefaults` and `build`.

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

[terraform/README.md](terraform/README.md) creates the cluster. After that, the same app runs against it with one setting changed:

```bash
# A kubeconfig context that uses the assistant's limited IAM role
$(terraform -chdir=terraform output -raw assistant_kubeconfig_command)

# Put the sample app images where the cluster can pull them from
./scripts/push-sample-app.sh "$(terraform -chdir=terraform output -raw image_registry)"

KUBE_CONTEXT=eks-assistant npm start
```

No code changes. `KUBE_CONTEXT` picks the cluster. The assistant reads the cluster's name from the kubeconfig and works out the image registry from it, because EKS cannot see images that exist only on your laptop.

**Creating a service on EKS** does three more things after Confirm, all from the assistant:

1. It runs the small Terraform stack in [terraform/service/](terraform/service/) to create one image repository for the service. Each service has its own state file, so this run cannot touch the cluster's state.
2. It builds the image for the cluster's x86 machines (`--platform linux/amd64`).
3. It logs Docker in to the registry and pushes the image.

These use your AWS login. Set `AWS_BUILD_PROFILE` in `.env` to name the profile; left empty, they use the login of the terminal the assistant was started in. The Kubernetes side still uses the limited assistant role.

The deployment history is kept per cluster in the same file. On EKS it starts empty, and what you did on kind is still there when you switch back.

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

Creating a service is tested the same way. Every question has tests for a good answer, `default` and each refusal. The folder check runs against real temporary folders, including a link that points outside the allowed folder. The programs the assistant starts are replaced by a fake that records the exact arguments ([tests/helpers/fakeBuildTools.ts](tests/helpers/fakeBuildTools.ts)), so no test runs Docker, kind, AWS or Terraform. The one file that really starts programs is tested by pointing each program name at Node itself.

The OpenAI path is tested without a key and without the network: the tests give the workflow a pretend model answer, and replace the network call under the real OpenAI library. They cover the checks on what the model says, every way a call can fail, and the fallback to the rules.

The page's logic that needs no browser is tested too ([frontend/tests/](frontend/tests/)): the API call and its error sentences, how a reply is cut into lines and tables, the Confirm and Cancel notes, the pod counts, the steps of a rollout, where Rollo stands on the rollout track, and the mood of Rollo (the robot in the chat). The React components themselves have no automated tests; they were checked by hand in the browser.

## Settings

| File | What it holds |
|---|---|
| [config/app.config.yaml](config/app.config.yaml) | Environment names, DEGRADED thresholds (with per-environment overrides), timeouts, the OpenAI model, the sample app's replicas, port, requests and limits, the default answers for a new service (`serviceDefaults`), and which folders may be built and for how long (`build`) |
| `.env` (copy of [.env.example](.env.example)) | Port, kubeconfig context, database file, the optional `OPENAI_API_KEY`, and for EKS the AWS profile, state bucket and owner tag used when a service is created. The key is the only secret; `.env` is not committed |
| [k8s/templates/](k8s/templates/) | The Deployment and Service the assistant creates, with readiness and liveness probes on the service's health path |
| `data/assistant.db` | The deployment history and the services created from the chat, both kept per cluster |

## Where things are

```
frontend/        the chat page (Next.js with shadcn/ui; built into frontend/out)
src/api/         web routes and error messages
src/agent/       understands messages (rules, or OpenAI through LangGraph), keeps one conversation per tab, holds the Confirm step
src/services/    deploy, roll back, scale, health, CPU and memory, history, the list of services
src/cluster/     the only code that uses the Kubernetes library
src/build/       the only code that starts programs: docker, kind, aws and terraform
src/types/       every type, one file per area (agent, cluster, deployment, ...)
src/constants/   every fixed value, one file per area
config/          thresholds, timeouts, environments
k8s/             manifest templates and local cluster files
sample-app/      the small app that gets deployed
greeter-app/     a second small app, for trying "create a service" (port 3000, reads a variable)
counter-app/     a third small app (port 4000, health check on /healthz)
terraform/       the EKS cluster, and terraform/service: one image repository per service
tests/           unit tests
```

## What is not done

- **Creating a service has run on kind, not yet on AWS.** On a local kind cluster the whole flow was run for real: questions, `docker build`, `kind load`, deploy, edit, rebuild and roll back. On AWS, the cluster stack was applied on 13 October 2026 and `sample-app` was deployed to it through the assistant. The new AWS parts have not been run there yet: the per-service Terraform stack, the push to the registry from the assistant, and the wider health-check port rule in the cluster stack. They are covered by unit tests with a fake in place of the real programs.
- **The assistant now starts programs on your machine.** Building a Dockerfile runs whatever that Dockerfile says, with your rights. This is a local tool for the person running it, not a shared service. What limits it: one file may start programs, only `docker`, `kind`, `aws` and `terraform`, with argument lists and no shell; the folder must be inside an allowed folder; the server answers only to this machine; and nothing runs before Confirm.
- **The AWS side of a create uses your own AWS login.** A separate role that may only create and fill this cluster's image repositories is the next step and is not built.
- **Variables are plain text.** They are stored in the database, shown in the summary and written into the Deployment. There is no support for secrets.
- **A build blocks its environment.** The lock is still one change per environment, so nothing else can change `staging` while an image for it is being built.
- **The services live in the local database.** If `data/assistant.db` is lost, the Deployments keep running, but the assistant no longer knows the settings of the services it created.
- **No delete.** The assistant cannot remove a service; its Kubernetes role has no delete right.
- **OpenAI mode is checked by hand only.** With a real key it read a dozen casual messages correctly. The automated tests use pretend model answers, so how well the real model reads messages in general is not measured.
- **Bonus features** from the test are not built: automatic rollback, charts, autoscaler status, fix suggestions, a logs command, login, Helm support, and running the assistant inside the cluster.
- **No login.** The name in the top right corner is typed by the user and stored as "requested by"; it does not prove who they are.
- **One backend instance.** Conversations and rollout progress are kept in memory, and the one-change-at-a-time lock is a local SQLite file.
- **No PodDisruptionBudget** in the Deployment template.

## Clean up

```bash
./scripts/kind-down.sh
```

On AWS, remove the image repositories of the services first, then the cluster, then the state bucket. [terraform/README.md](terraform/README.md) has the order and the commands; [scripts/destroy-service-infra.sh](scripts/destroy-service-infra.sh) removes the repositories.
