# The EKS cluster, its worker nodes, and the add-ons it needs.
#
# The community EKS module creates the cluster, the node group with its launch
# template, the IAM roles for the cluster and the nodes, the KMS key and the log
# group. What is decided here is listed next to each setting.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.29.0"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  # The API endpoint is reachable from inside the VPC, and from the internet only
  # for the listed IP ranges. Everyone else is refused before authentication.
  endpoint_private_access      = true
  endpoint_public_access       = true
  endpoint_public_access_cidrs = var.api_allowed_cidrs

  # Kubernetes Secrets are encrypted with a key we own before EKS stores them.
  create_kms_key                  = true
  enable_kms_key_rotation         = true
  kms_key_deletion_window_in_days = 7
  encryption_config = {
    resources = ["secrets"]
  }

  # All five kinds of control plane log go to CloudWatch.
  enabled_log_types                      = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  cloudwatch_log_group_retention_in_days = var.log_retention_days

  # Who may use the cluster is decided by EKS access entries only (no aws-auth ConfigMap).
  authentication_mode = "API"

  # The identity that runs Terraform becomes cluster admin. Terraform needs this to
  # create the namespaces and RBAC objects. The assistant does NOT get this.
  enable_cluster_creator_admin_permissions = true

  access_entries = {
    # Maps the assistant's IAM role to a Kubernetes group, and nothing more. No EKS
    # access policy is attached, so the role can do only what Kubernetes RBAC gives
    # that group (see modules/kubernetes).
    assistant = {
      principal_arn     = aws_iam_role.assistant.arn
      kubernetes_groups = [var.assistant_group]
    }
  }

  addons = {
    # Pod networking has to be in place before the first node joins.
    vpc-cni = {
      before_compute = true
    }
    kube-proxy = {}
    coredns    = {}
    # Provides the CPU and memory numbers the assistant reports.
    metrics-server = {}
  }

  # The assistant calls GET /health through the Kubernetes API, so the control plane
  # must be able to open a connection to the pods on the port the app listens on.
  # The module opens only the ports Kubernetes itself needs (kubelet, webhooks), so
  # each app port is added here: from the control plane only, and nothing wider.
  node_security_group_additional_rules = {
    for port in var.app_ports : "ingress_cluster_app_${port}" => {
      description                   = "Cluster API to app pods on port ${port}, for the health check"
      protocol                      = "tcp"
      from_port                     = port
      to_port                       = port
      type                          = "ingress"
      source_cluster_security_group = true
    }
  }

  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_instance_type]
      ami_type       = "AL2023_x86_64_STANDARD"

      min_size     = var.node_min_size
      desired_size = var.node_desired_size
      max_size     = var.node_max_size

      # Nodes go into the private subnets passed in above; they get no public IP.

      # IMDSv2 only: the instance metadata service answers only requests that carry
      # a session token. Hop limit 1 keeps pods from reaching it and borrowing the
      # node's IAM role.
      metadata_options = {
        http_endpoint               = "enabled"
        http_tokens                 = "required"
        http_put_response_hop_limit = 1
      }
    }
  }

  tags = var.tags
}
