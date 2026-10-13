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
| State | An S3 bucket for the Terraform state, created by a separate small stack |

## Layout

```
bootstrap/            the S3 state bucket; applied once, first
modules/network/      VPC, subnets, NAT gateway
modules/cluster/      EKS, node group, KMS key, logging, add-ons, the assistant's IAM role, ECR
modules/kubernetes/   namespaces, Role, RoleBinding, read-only ClusterRole for nodes
envs/                 staging.tfvars, prod.tfvars and the matching backend settings
main.tf               wires the three modules together
```

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

It runs `terraform fmt -check`, `terraform validate` on both stacks and `tflint` with the AWS rules. It needs no AWS credentials. The GitHub workflow in `.github/workflows/terraform.yml` runs the same script on every change to this folder.

Provider versions are pinned in `versions.tf` and recorded exactly, with checksums for Linux and macOS, in `.terraform.lock.hcl`.

## Destroy everything

```bash
terraform destroy -var-file=envs/staging.tfvars

# then the state bucket
terraform -chdir=bootstrap apply   -var owner=<your-name> -var force_destroy=true
terraform -chdir=bootstrap destroy -var owner=<your-name> -var force_destroy=true
```

Things to know:

- Terraform removes the namespaces first, which deletes whatever the assistant deployed in them, and then the cluster.
- The assistant creates only `ClusterIP` Services, so no load balancer is left behind.
- The KMS key is not deleted at once. AWS keeps it "pending deletion" for 7 days, which is the shortest period AWS allows.
- `force_destroy=true` is needed because the bucket still holds old versions of the state file.

To check that nothing is left:

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=deployment-assistant \
  --query 'ResourceTagMappingList[].ResourceARN'
```

## Cost

An EKS control plane costs about $0.10 per hour, a NAT gateway about $0.05, and two `t3.medium` nodes about $0.10 together. That is roughly $0.25 per hour, or $6 per day, for the staging settings. Destroy the cluster when you are done.

## What has been verified

- `terraform fmt -check`, `terraform validate` and `tflint`: pass.
- The assistant's Kubernetes permissions: tested on a local kind cluster with a login limited to exactly these rules. Deploy, roll back, scale, health, logs, CPU and memory, and nodes all worked; delete, Secrets and other namespaces were refused.
- `terraform plan` and `terraform apply` on AWS: **not run yet.**
