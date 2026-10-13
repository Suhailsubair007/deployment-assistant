variable "namespaces" {
  description = "Namespaces to create. The assistant treats each one as an environment."
  type        = list(string)
}

variable "assistant_group" {
  description = "Kubernetes group that receives the assistant's permissions. The assistant's IAM role is mapped to this group by an EKS access entry."
  type        = string
}
