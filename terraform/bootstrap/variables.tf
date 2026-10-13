variable "region" {
  description = "AWS region for the state bucket. Use the same region as the cluster."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Project name. Used in the bucket name and as the project tag."
  type        = string
  default     = "deployment-assistant"
}

variable "owner" {
  description = "Who is responsible for these resources. Used as the owner tag."
  type        = string
}

variable "force_destroy" {
  description = "Allow terraform destroy to delete the bucket while it still holds state files. Set to true only when tearing everything down."
  type        = bool
  default     = false
}
