# ---- Where and for whom ----

variable "region" {
  description = "AWS region to create everything in."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project name, used as the project tag on every resource."
  type        = string
  default     = "deployment-assistant"
}

variable "owner" {
  description = "Who is responsible for these resources, used as the owner tag on every resource."
  type        = string
}

variable "environment" {
  description = "Which infrastructure environment this is, for example staging or prod. Used as a tag."
  type        = string
}

# ---- Cluster ----

variable "cluster_name" {
  description = "Name of the EKS cluster."
  type        = string
  default     = "deployment-assistant"
}

variable "kubernetes_version" {
  description = "Kubernetes version of the cluster, for example 1.35. Check what EKS supports with: aws eks describe-cluster-versions"
  type        = string
  default     = "1.35"
}

variable "api_allowed_cidrs" {
  description = "IP ranges that may reach the cluster's public API endpoint, for example [\"203.0.113.10/32\"]. There is no default on purpose: you must decide who gets in."
  type        = list(string)

  validation {
    condition     = length(var.api_allowed_cidrs) > 0 && !contains(var.api_allowed_cidrs, "0.0.0.0/0")
    error_message = "List at least one IP range, and do not use 0.0.0.0/0: that opens the cluster API to the whole internet."
  }
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the control plane logs."
  type        = number
  default     = 30
}

# ---- Worker nodes ----

variable "node_instance_type" {
  description = "EC2 instance type of the worker nodes."
  type        = string
  default     = "t3.medium"
}

variable "node_min_size" {
  description = "Smallest number of worker nodes."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Number of worker nodes to start with."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Largest number of worker nodes."
  type        = number
  default     = 3
}

# ---- Network ----

variable "vpc_cidr" {
  description = "IP range of the VPC. Must be a /16."
  type        = string
  default     = "10.0.0.0/16"
}

variable "single_nat_gateway" {
  description = "true: one NAT gateway shared by all zones (cheaper). false: one per zone, so outbound traffic survives the loss of a zone."
  type        = bool
  default     = true
}

# ---- Inside the cluster ----

variable "namespaces" {
  description = "Namespaces to create. The assistant treats each one as an environment it can deploy to."
  type        = list(string)
  default     = ["staging", "prod"]
}

variable "app_ports" {
  description = "Ports the deployed apps listen on (the port in config/app.config.yaml). The assistant calls GET /health through the Kubernetes API, so the control plane must be allowed to reach the pods on these ports."
  type        = list(number)
  default     = [8080]

  validation {
    condition     = alltrue([for port in var.app_ports : port >= 1 && port <= 65535])
    error_message = "Every port must be between 1 and 65535."
  }
}

variable "assistant_trusted_principal_arns" {
  description = "IAM users or roles allowed to assume the assistant's role. Leave empty to allow only the identity that runs Terraform."
  type        = list(string)
  default     = []
}

variable "create_sample_app_repository" {
  description = "Create an ECR repository for the sample app images, so there is somewhere the cluster can pull them from."
  type        = bool
  default     = true
}
