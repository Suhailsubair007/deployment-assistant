# The main stack: network, cluster, and what the assistant needs inside the cluster.
# Staging and prod use this same code with a different file from envs/.

locals {
  tags = {
    project     = var.project
    owner       = var.owner
    environment = var.environment
  }

  # The name of the Kubernetes group the assistant's IAM role is mapped to.
  # The cluster module puts the role into this group; the kubernetes module gives the group its permissions.
  assistant_group = "deployment-assistant"
}

# Who is running Terraform. Used as the default identity allowed to act as the assistant.
data "aws_caller_identity" "current" {}

# When Terraform runs with a temporary role session, this gives the role behind it.
data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

module "network" {
  source = "./modules/network"

  name               = var.cluster_name
  vpc_cidr           = var.vpc_cidr
  single_nat_gateway = var.single_nat_gateway
  tags               = local.tags
}

module "cluster" {
  source = "./modules/cluster"

  cluster_name       = var.cluster_name
  kubernetes_version = var.kubernetes_version
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  api_allowed_cidrs  = var.api_allowed_cidrs
  log_retention_days = var.log_retention_days

  node_instance_type = var.node_instance_type
  node_min_size      = var.node_min_size
  node_desired_size  = var.node_desired_size
  node_max_size      = var.node_max_size

  assistant_group = local.assistant_group
  assistant_trusted_principal_arns = (
    length(var.assistant_trusted_principal_arns) > 0
    ? var.assistant_trusted_principal_arns
    : [data.aws_iam_session_context.current.issuer_arn]
  )

  create_sample_app_repository = var.create_sample_app_repository
  tags                         = local.tags
}

module "kubernetes" {
  source = "./modules/kubernetes"

  namespaces      = var.namespaces
  assistant_group = local.assistant_group

  # Namespaces and RBAC can only be created once the cluster and its nodes exist.
  # On destroy the order is reversed: these objects go first, then the cluster.
  depends_on = [module.cluster]
}
