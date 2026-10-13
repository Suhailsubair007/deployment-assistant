variable "cluster_name" {
  description = "Name of the EKS cluster."
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes version of the cluster, for example 1.35."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC the cluster is created in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the worker nodes and the cluster's network interfaces."
  type        = list(string)
}

variable "api_allowed_cidrs" {
  description = "IP ranges that may reach the cluster's public API endpoint."
  type        = list(string)
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the control plane logs."
  type        = number
}

variable "node_instance_type" {
  description = "EC2 instance type of the worker nodes."
  type        = string
}

variable "node_min_size" {
  description = "Smallest number of worker nodes."
  type        = number
}

variable "node_desired_size" {
  description = "Number of worker nodes to start with."
  type        = number
}

variable "node_max_size" {
  description = "Largest number of worker nodes."
  type        = number
}

variable "app_ports" {
  description = "Ports the deployed apps listen on. The control plane may reach the worker nodes on these ports."
  type        = list(number)
}

variable "assistant_group" {
  description = "Kubernetes group the assistant's IAM role is mapped to."
  type        = string
}

variable "assistant_trusted_principal_arns" {
  description = "IAM users or roles allowed to assume the assistant's role."
  type        = list(string)
}

variable "create_sample_app_repository" {
  description = "Create an ECR repository for the sample app images."
  type        = bool
}

variable "tags" {
  description = "Tags for every resource in this module."
  type        = map(string)
}
