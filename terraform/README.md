# EKS cluster with Terraform

This folder creates everything the Deployment Assistant needs on AWS. Nothing is created by hand in the console.

## What it creates

| Part | Details |
|---|---|
| Network | A VPC over two availability zones with public and private subnets, an internet gateway and a NAT gateway |
| Cluster | An EKS cluster with a managed node group. The nodes are in the private subnets and have no public IP address |
| IAM | The roles the cluster and nodes need, and one small role for the assistant |
| Add-ons | VPC CNI, kube-proxy, CoreDNS and metrics-server |
| In the cluster | The `staging` and `prod` namespaces, and the assistant's Role and RoleBinding in each |
| Registry | An ECR repository for the sample app images |
| Registry per service | One ECR repository for each service created from the chat. The assistant creates these itself, with the small `service/` stack |
| State | An S3 bucket for the Terraform state, created by a separate small stack |

## Layout

```
bootstrap/            the S3 state bucket; applied once, first
modules/network/      VPC, subnets, NAT gateway
modules/cluster/      EKS, node group, KMS key, logging, add-ons, the assistant's IAM role, the sample app's ECR repository
modules/kubernetes/   namespaces, Role, RoleBinding, read-only ClusterRole for nodes
envs/                 staging.tfvars, prod.tfvars and the matching backend settings
main.tf               wires the three modules together
service/              one ECR repository for one service; run by the assistant, not by hand
```

There are three stacks, each with its own state: `bootstrap/`, the main stack (this folder) and `service/`. A person applies the first two. The assistant runs the third.

## What you need

- Terraform 1.11 or newer (written with 1.16.5)
- AWS CLI v2, logged in to an account where you may create VPC, EKS, IAM, KMS, S3, ECR and CloudWatch resources
- kubectl

Set the AWS profile and region once per terminal:

```bash
export AWS_PROFILE=deploy-assistant
export AWS_REGION=ap-south-1
```

## Create the cluster

Run every command from this folder. The steps must happen in this order.

### 1. State bucket

```bash
terraform -chdir=bootstrap init
terraform -chdir=bootstrap apply -var owner=<your-name>
```

**Why a separate stack with local state.** The main stack keeps its state in S3. That bucket has to exist before the main stack can store anything in it, so something else must create it. The bootstrap stack does that and keeps its own state in a local file (`bootstrap/terraform.tfstate`, not committed). It creates four resources that never change, so losing that file costs little: the bucket can be imported again with `terraform import`. The alternatives are to create the bucket by hand, which the test forbids, or to create it with local state and then move that state into the bucket, which adds a step that is easy to get wrong.

### 2. Connect the main stack to the bucket

```bash
terraform init \
  -backend-config="bucket=$(terraform -chdir=bootstrap output -raw state_bucket)" \
  -backend-config="region=$AWS_REGION" \
  -backend-config=envs/staging.backend.hcl
```

Locking uses an S3 lock file (`use_lockfile = true`). While one person runs `plan` or `apply`, a second person's run stops with a lock message instead of writing over the same state.

### 3. Plan and apply

The cluster API is open only to the IP ranges you list. There is no default, and `0.0.0.0/0` is refused.

```bash
export TF_VAR_api_allowed_cidrs="[\"$(curl -s https://checkip.amazonaws.com)/32\"]"

terraform plan  -var-file=envs/staging.tfvars
terraform apply -var-file=envs/staging.tfvars
```

`apply` takes about 15 to 20 minutes. Running `terraform plan -var-file=envs/staging.tfvars` again straight afterwards must report no changes.

### 4. Use the cluster with the assistant

```bash
# A context that uses the assistant's limited role
$(terraform output -raw assistant_kubeconfig_command)

# Push the sample app images, then start the app against EKS
cd ..
./scripts/push-sample-app.sh "$(terraform -chdir=terraform output -raw image_registry)"
KUBE_CONTEXT=eks-assistant \
IMAGE_REGISTRY="$(terraform -chdir=terraform output -raw image_registry)" \
npm start
```

The app code is the same as on kind. Only the context and the image registry differ.

To look around as an administrator instead, run `$(terraform output -raw update_kubeconfig_command)`.

## Inputs

| Variable | Default | Meaning |
|---|---|---|
| `region` | `ap-south-1` | AWS region |
| `cluster_name` | `deployment-assistant` | Name of the EKS cluster |
| `kubernetes_version` | `1.35` | Kubernetes version of the cluster |
| `node_instance_type` | `t3.medium` | Instance type of the worker nodes |
| `node_min_size`, `node_desired_size`, `node_max_size` | 2, 2, 3 | Number of worker nodes |
| `api_allowed_cidrs` | none, required | IP ranges that may reach the cluster API |
| `owner` | none, required | Value of the `owner` tag |
| `environment` | none, required | Value of the `environment` tag |
| `project` | `deployment-assistant` | Value of the `project` tag |
| `vpc_cidr` | `10.0.0.0/16` | IP range of the VPC |
| `single_nat_gateway` | `true` | One NAT gateway, or one per zone when `false` |
| `log_retention_days` | 30 | How long control plane logs are kept |
| `namespaces` | `["staging", "prod"]` | Namespaces to create |
| `assistant_trusted_principal_arns` | the identity running Terraform | Who may assume the assistant's role |
| `create_sample_app_repository` | `true` | Create the ECR repository |

No account ID appears anywhere in the code. Where one is needed, it is looked up from the credentials in use.

## Outputs

| Output | Meaning |
|---|---|
| `cluster_name` | Name of the cluster |
| `cluster_endpoint` | URL of the Kubernetes API |
| `update_kubeconfig_command` | Command that adds an admin context to your kubeconfig |
| `assistant_kubeconfig_command` | Command that adds the `eks-assistant` context, which uses the assistant's role |
| `assistant_role_arn` | The assistant's IAM role |
| `image_registry` | Value for the app's `IMAGE_REGISTRY` setting |

## Staging and prod

Both use the same code. The differences are in two small files:

| | `envs/staging.tfvars` | `envs/prod.tfvars` |
|---|---|---|
| Nodes | 2 × `t3.medium`, up to 3 | 3 × `t3.large`, up to 6 |
| NAT gateways | one, shared | one per zone |
| Log retention | 7 days | 90 days |
| VPC range | `10.0.0.0/16` | `10.1.0.0/16` |

Each has its own state file in the bucket (`envs/staging.backend.hcl`, `envs/prod.backend.hcl`), so a mistake in one cannot damage the other. To work on prod, run step 2 again with `-reconfigure` and `envs/prod.backend.hcl`, then use `-var-file=envs/prod.tfvars`.

A note on the word "environment". The test asks for `staging` and `prod` namespaces inside the cluster, and also for staging and prod `.tfvars` files. I read that as two levels: each `.tfvars` file sizes one cluster, and every cluster contains both namespaces, because the assistant treats a namespace as an environment.

## What the community modules do, and what I set

I use `terraform-aws-modules/vpc/aws` and `terraform-aws-modules/eks/aws`, both pinned to an exact version. They create the many small pieces correctly: route tables, the node launch template, the node and cluster IAM roles, the KMS key policy. My own modules wrap them and make the decisions:

**Network**
- Subnet layout: `/20` private subnets, because every pod takes an address from them, and `/24` public subnets.
- Nodes get no public IP address.
- One NAT gateway by default to keep cost down. The price is that a failure of that zone stops outbound traffic from all nodes, so prod uses one per zone.
- The subnet tags EKS reads to place load balancers.

**Cluster**
- API endpoint: private access on, public access only for `api_allowed_cidrs`.
- Kubernetes Secrets encrypted with a KMS key that has rotation on.
- All five control plane log types sent to CloudWatch.
- `authentication_mode = "API"`: access is managed with EKS access entries only.
- Nodes: IMDSv2 required, with a hop limit of 1 so pods cannot reach the node's credentials.
- Add-ons: metrics-server is installed as an EKS add-on.
- One extra firewall rule for the health check, described next.

## The port rule for the health check

The assistant's health check calls each service's health path through the Kubernetes API server. For that, the control plane must be able to open a connection to a pod on the port its app listens on. The EKS module opens only the ports Kubernetes itself needs, so `modules/cluster/main.tf` adds one rule to the worker nodes' security group:

| | |
|---|---|
| Direction | into the worker nodes |
| From | the cluster's own control plane (the cluster security group), and nothing else |
| Ports | TCP 1024 to 65535 |

**What changed.** Before, there was one rule per port in a variable named `app_ports` (default `[8080]`). That stopped working once services could be created from the chat: the user chooses the port there, and opening it would have meant changing this stack for every new service. The assistant must never change this stack. The chat accepts only ports 1024 to 65535, so the rule now covers exactly that range, and `app_ports` is gone.

**Why the range is acceptable.** The source did not get wider. It is still only the control plane: no IP range, nothing from the internet, no other machine in the VPC. The control plane can already reach the kubelet on every node (port 10250), and the kubelet controls every pod on its node. Being able to call the apps' own ports as well gives the control plane very little that it did not already have.

This rule is in the code but **not applied yet** (see [What has not been verified](#what-has-not-been-verified)). When it is applied, `terraform plan` should show only the new rule being added and the old rule for port 8080 being removed. If the plan shows more than that, stop and read it before applying.

## Services created from the chat

A new service needs somewhere to keep its images. When a user creates a service in the chat and clicks Confirm, the assistant creates that place itself, by running the small stack in `service/`. A person does not run this stack.

**What it creates.** One ECR repository named `<cluster_name>/<service_name>`, set up like the sample app's: a tag can never be pointed at a different image, every image is scanned when it is pushed, and `force_delete` is on, so the stack can be destroyed while the repository still holds images. Nothing else. It uses only the AWS provider, so it works even when the cluster's API cannot be reached.

**Why a separate stack.** The main stack is applied by a person who has read the plan, and the assistant must not be able to change it. So the assistant runs a different stack with a different state file. The most a run can do is create or change one image repository.

**State.** The same bucket as the main stack, with one state file per service:

```
deployment-assistant/services/<cluster_name>/<service_name>/terraform.tfstate
```

The assistant passes the bucket, this key and the region to `terraform init`, with `use_lockfile=true` and `encrypt=true`, as in step 2 above. The one `service/` folder is used for every service, so it also passes `-reconfigure`, which switches the folder to the right state file each time.

Two things follow from that:

- If two runs for the same service start together, the second stops at the lock.
- Runs for different services must not overlap. The folder remembers only one state file at a time, so a second `init` in the middle of another run would point that run at the wrong service's state. Whoever runs this stack must finish one service before starting the next.

**Inputs and output.**

| Variable | Default | Meaning |
|---|---|---|
| `region` | none, required | Region of the cluster |
| `cluster_name` | none, required | Name of the cluster; first part of the repository name. Must not be empty |
| `service_name` | none, required | Name of the service; second part of the repository name. Lowercase letters, digits and dashes, starting with a letter, at most 40 characters |
| `owner` | `deployment-assistant` | Value of the `owner` tag |
| `project` | `deployment-assistant` | Value of the `project` tag |

The output is `repository_url`, the address images are pushed to. The repository gets the tags `project`, `owner`, `cluster`, `service` and `created_by = deployment-assistant`, so it is easy to see which repositories the assistant made and for which service.

**AWS rights the run needs.** The run uses the app's own AWS credentials: the ones it was started with, or a profile set for it. That is not the assistant's cluster role from the next section, which still can only describe the cluster. The run needs these rights and no others:

| On | Actions | Why |
|---|---|---|
| The state bucket | `s3:ListBucket`, limited to the prefix `deployment-assistant/services/` | Terraform looks for the state file |
| Objects under `deployment-assistant/services/` in that bucket | `s3:GetObject`, `s3:PutObject` | Read and write the state file |
| The lock files there (`…/terraform.tfstate.tflock`) | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` | Take the lock and give it back |
| ECR repositories named `<cluster_name>/*` in this account and region | `ecr:CreateRepository`, `ecr:TagResource`, `ecr:DescribeRepositories`, `ecr:ListTagsForResource` | Create the repository with its tags, and read it back |

Things to know about this list:

- It has no `ecr:DeleteRepository`. The assistant only creates. Removing repositories is done by a person, with `scripts/destroy-service-infra.sh`, and that person needs `ecr:DeleteRepository` as well.
- It does not cover pushing images. That is a separate step after this run, with ECR push rights of its own.
- No stack creates an IAM policy with exactly these rights yet. Today the run can do whatever the app's AWS credentials can do. The list says what a policy for it should contain.
- The list comes from the calls Terraform makes for this stack. It has not been tested yet with credentials limited to exactly these rights.

## How the assistant gets access, and why it is not cluster-admin

1. `aws eks get-token` signs a short-lived token with the assistant's IAM role.
2. EKS checks the signature with AWS IAM, so it knows which role is calling.
3. An **access entry** maps that role to the Kubernetes group `deployment-assistant`. No EKS access policy is attached to it.
4. A **RoleBinding** in `staging` and in `prod` gives that group a Role with only the calls the app makes.

| Where | Resource | Allowed |
|---|---|---|
| `staging`, `prod` | deployments | get, create, update |
| | services | get, create, update |
| | services/proxy | get (the `/health` call) |
| | pods | list |
| | pods/log | get |
| | events | list |
| | namespaces | get |
| | pods in `metrics.k8s.io` | list |
| whole cluster | nodes, nodes in `metrics.k8s.io` | list |

Nodes belong to no namespace, so reading them cannot be granted by a namespaced Role. That one read-only ClusterRole is the only cluster-wide permission.

The assistant cannot delete anything, read Secrets, run commands in pods, or touch any other namespace. If its credentials leak, the damage stays inside two namespaces. With cluster-admin, the same leak would hand over every Secret and every workload in the cluster.

On the AWS side the role has one permission: `eks:DescribeCluster` on this one cluster.

The same Kubernetes rules are in [../k8s/local/assistant-rbac.yaml](../k8s/local/assistant-rbac.yaml), so they can be tested on a local kind cluster with `scripts/kind-restricted-context.sh`.

## Checks

```bash
../scripts/tf-check.sh
```

It runs `terraform fmt -check`, `terraform validate` on all three stacks (`bootstrap/`, the main stack and `service/`) and `tflint` with the AWS rules. It needs no AWS credentials and does not contact AWS. The GitHub workflow in `.github/workflows/terraform.yml` runs the same script on every change to this folder.

One detail keeps that true. `validate` needs the providers and modules, and the script gets them with `terraform init -backend=false`. But in a folder that a real `terraform init` has already connected to the state bucket, even `init -backend=false` reads the state from S3. So in such a folder the script skips `init` and validates with what is already downloaded.

Provider versions are pinned in each stack's `versions.tf` and recorded exactly, with checksums for Linux and macOS, in each stack's `.terraform.lock.hcl`. All three stacks use the same AWS provider version.

## Destroy everything

The order matters: the services' repositories first, then the cluster, then the state bucket.

```bash
# 1. the image repositories of the services created from the chat
../scripts/destroy-service-infra.sh \
  "$(terraform -chdir=bootstrap output -raw state_bucket)" "$AWS_REGION" deployment-assistant-staging

# 2. the cluster
terraform destroy -var-file=envs/staging.tfvars

# 3. the state bucket
terraform -chdir=bootstrap apply   -var owner=<your-name> -var force_destroy=true
terraform -chdir=bootstrap destroy -var owner=<your-name> -var force_destroy=true
```

Things to know:

- Step 1 runs `terraform destroy` on the `service/` stack once for every service of that cluster. It finds the services by listing their state files in the bucket, prints them, and does nothing until you type `yes`. At the end it says which repositories are gone. Stop the assistant before you run it.
- Step 1 must come before step 3. Each service's state file is in the bucket. Once the bucket is gone, Terraform no longer knows these repositories exist, and they would have to be found and deleted by hand.
- Deleting a repository deletes every image in it.
- Terraform removes the namespaces first, which deletes whatever the assistant deployed in them, and then the cluster.
- The assistant creates only `ClusterIP` Services, so no load balancer is left behind.
- The KMS key is not deleted at once. AWS keeps it "pending deletion" for 7 days, which is the shortest period AWS allows.
- `force_destroy=true` is needed because the bucket still holds old versions of the state files.

To check that nothing is left:

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=deployment-assistant \
  --query 'ResourceTagMappingList[].ResourceARN'
```

## Cost

An EKS control plane costs about $0.10 per hour, a NAT gateway about $0.05, and two `t3.medium` nodes about $0.10 together. That is roughly $0.25 per hour, or $6 per day, for the staging settings. Destroy the cluster when you are done.

## What has been verified

- `terraform fmt -check`, `terraform validate` and `tflint`: pass, for all three stacks.
- The assistant's Kubernetes permissions: tested on a local kind cluster with a login limited to exactly these rules. Deploy, roll back, scale, health, logs, CPU and memory, and nodes all worked; delete, Secrets and other namespaces were refused.
- The staging stack on AWS: applied on 2026-10-13 with `envs/staging.tfvars`. It created 71 resources. A second `terraform plan` afterwards reported no changes.
- The sample app on that cluster: deployed to it with the assistant.

## What has not been verified

Written on 2026-10-14. Each of these is still open:

- **Prod.** `envs/prod.tfvars` was only planned. It has never been applied.
- **The `service/` stack.** It passes `validate` and `tflint`. It has not been planned or applied, so no repository has been created with it yet. The rules for `service_name` and `cluster_name` are only checked at plan time, so they have not been exercised either.
- **`scripts/destroy-service-infra.sh`.** Written, never run.
- **The port range rule.** Not applied. The staging cluster still has what was applied on 2026-10-13: the rule for port 8080 only. Until the new rule is applied, the health check of a service that listens on another port will not get through.
- **The AWS rights listed for the service run.** Not tested with credentials limited to exactly those rights.
